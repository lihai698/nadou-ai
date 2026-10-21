function refreshIcons(){ if(window.lucide) lucide.createIcons(); }
refreshIcons();
function tr(key){ return window.StudioI18n ? StudioI18n.t(key) : key; }
function trf(key, values={}){
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), tr(key));
}
function langIsEn(){ return window.StudioI18n?.lang?.() === 'en'; }
const CANVAS_UPLOAD_MAX = 20;
const CANVAS_UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024;
const CANVAS_UPLOAD_MAX_BATCH_BYTES = 500 * 1024 * 1024;
const CANVAS_REFERENCE_IMAGE_MAX = 20;






function actionFailed(labelKey, detail=''){
    const label = tr(labelKey);
    return langIsEn() ? `${label} failed${detail ? `: ${detail}` : ''}` : `${label}失败${detail ? `：${detail}` : ''}`;
}
function noReturnedImage(labelKey){ return langIsEn() ? `${tr(labelKey)} failed: no image returned` : `${tr(labelKey)}失败：未返回图片`; }
function classicMediaSourceHost(){
    return {
        get URL(){return URL;},
        get window(){return window;},
        canvasOriginalMediaUrl:(...args)=>canvasOriginalMediaUrl(...args),
        canvasFileNameFromUrl:(...args)=>canvasFileNameFromUrl(...args),
        canvasProxiedMediaUrl:(...args)=>canvasProxiedMediaUrl(...args),
        canvasDisplayMediaUrl:(...args)=>canvasDisplayMediaUrl(...args),
        canvasMediaPreviewUrl:(...args)=>canvasMediaPreviewUrl(...args),
        escapeAttr:(...args)=>escapeAttr(...args)
    };
}
function canvasOriginalMediaUrl(url){
    return CanvasMediaSources.canvasOriginalMediaUrl(classicMediaSourceHost(), url);
}
function canvasFileNameFromUrl(url=''){
    return CanvasMediaSources.canvasFileNameFromUrl(classicMediaSourceHost(), url);
}
function canvasProxiedMediaUrl(url, name=''){
    return CanvasMediaSources.canvasProxiedMediaUrl(classicMediaSourceHost(), url, name);
}
function canvasDisplayMediaUrl(url, name=''){
    return CanvasMediaSources.canvasDisplayMediaUrl(classicMediaSourceHost(), url, name);
}
function canvasMediaPreviewUrl(url, size=512){
    return CanvasMediaSources.canvasMediaPreviewUrl(classicMediaSourceHost(), url, size);
}
function canvasPreviewImgHtml(url, size=512, attrs=''){
    return CanvasMediaSources.canvasPreviewImgHtml(classicMediaSourceHost(), url, size, attrs);
}
function loadCanvasOriginalImageDimensions(url){
    const src = String(url || '');
    if(!src || /^data:/i.test(src) || /^blob:/i.test(src)) return Promise.resolve(null);
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? {w:img.naturalWidth, h:img.naturalHeight} : null);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}
function canvasVideoPreviewHtml(url, size=512, attrs=''){
    return CanvasMediaSources.canvasVideoPreviewHtml(classicMediaSourceHost(), url, size, attrs);
}
function canvasVideoFallbackHtml(url, attrs=''){
    return CanvasMediaSources.canvasVideoFallbackHtml(classicMediaSourceHost(), url, attrs);
}
function canvasVideoPlayerHtml(url, attrs=''){
    return CanvasMediaSources.canvasVideoPlayerHtml(classicMediaSourceHost(), url, attrs);
}
function canvasActivateVideoPreview(img){
    if(!img) return false;
    const target = img.matches?.('img[data-preview-kind="video"]') ? img : img.querySelector?.('img[data-preview-kind="video"]');
    if(!target) {
        const fallback = img.matches?.('video[data-url]') ? img : img.querySelector?.('video[data-url]');
        if(fallback){
            fallback.controls = true;
            fallback.muted = false;
            fallback.play?.().catch(() => {});
            return true;
        }
        return false;
    }
    const original = canvasOriginalMediaUrl(target.dataset.originalSrc || target.dataset.url || target.getAttribute('src') || '');
    if(!original) return false;
    const tpl = document.createElement('template');
    tpl.innerHTML = canvasVideoPlayerHtml(original, target.dataset.videoPlayerAttrs || '');
    const video = tpl.content.firstElementChild;
    if(!video) return false;
    target.replaceWith(video);
    video.parentElement?.querySelector?.('.canvas-video-play')?.style?.setProperty('display', 'none');
    video.play?.().catch(() => {});
    return true;
}
function isCanvasPreviewImage(img){
    return img?.tagName?.toLowerCase?.() === 'img'
        && img.dataset?.previewSrc
        && img.dataset?.originalSrc
        && img.dataset.previewSrc !== img.dataset.originalSrc
        && img.getAttribute('src') !== img.dataset.originalSrc;
}
function bindCanvasPreviewImageFallbacks(root=document){
    root.querySelectorAll?.('img[data-preview-src][data-original-src]:not([data-preview-fallback-bound])').forEach(img => {
        img.dataset.previewFallbackBound = '1';
        const fallback = () => {
            if(!img.parentElement) return;
            const original = img.dataset.originalSrc || img.dataset.url || '';
            if(img.dataset.previewKind === 'video'){
                const video = document.createElement('template');
                video.innerHTML = canvasVideoFallbackHtml(original, img.dataset.videoFallbackAttrs || '');
                img.replaceWith(video.content.firstElementChild);
                return;
            }
            if(original && img.getAttribute('src') !== original) img.src = original;
        };
        img.addEventListener('error', fallback);
        // 动态输入列表可能在绑定前就收到预览接口的错误响应。
        if(img.complete && !img.naturalWidth) fallback();
    });
}
const CANVAS_SELECTED_HIGH_RES_DELAY = 320;
const CANVAS_HIGH_RES_ZOOM_THRESHOLD = 0.86;
let canvasSelectedHighResTimer = 0;
let canvasSelectedHighResSeq = 0;
let canvasImageResolutionSyncTimer = 0;
const canvasSelectedHighResLoaded = new Set();
const canvasSelectedHighResLoading = new Map();
function canvasImageEditorIsOpen(){
    return Boolean(document.getElementById('imageEditModal')?.classList.contains('open'));
}
function preloadCanvasSelectedHighRes(src){
    if(!src || canvasSelectedHighResLoaded.has(src)) return Promise.resolve(true);
    if(canvasSelectedHighResLoading.has(src)) return canvasSelectedHighResLoading.get(src);
    const task = new Promise(resolve => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = async () => {
            try { if(img.decode) await img.decode(); } catch(e) {}
            canvasSelectedHighResLoaded.add(src);
            resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = src;
    }).finally(() => canvasSelectedHighResLoading.delete(src));
    canvasSelectedHighResLoading.set(src, task);
    return task;
}
function canvasViewportWantsHighRes(){
    return Number(viewport?.scale || 1) >= CANVAS_HIGH_RES_ZOOM_THRESHOLD;
}
function canvasImageNearViewport(img){
    if(!img?.isConnected || !board) return false;
    const boardRect = board.getBoundingClientRect();
    const rect = img.getBoundingClientRect();
    const margin = 220;
    return rect.right >= boardRect.left - margin && rect.left <= boardRect.right + margin
        && rect.bottom >= boardRect.top - margin && rect.top <= boardRect.bottom + margin;
}
function syncCanvasSelectedImageResolution(root=nodesEl){
    const selectedImages = [];
    const wantHighRes = canvasViewportWantsHighRes();
    root.querySelectorAll?.('.node img[data-preview-src][data-original-src]').forEach(img => {
        if(img.dataset.previewKind === 'video') return;
        const preview = img.dataset.previewSrc || '';
        const original = img.dataset.originalSrc || img.dataset.url || '';
        if(!wantHighRes || !canvasImageNearViewport(img)){
            delete img.dataset.selectedHighResTarget;
            if(preview && img.getAttribute('src') !== preview) img.src = preview;
            return;
        }
        const target = canvasDisplayMediaUrl(original);
        if(!target) return;
        img.dataset.selectedHighResTarget = target;
        if(canvasSelectedHighResLoaded.has(target)){
            if(img.getAttribute('src') !== target) img.src = target;
            return;
        }
        if(preview && img.getAttribute('src') !== preview) img.src = preview;
        selectedImages.push({img, target});
    });
    if(canvasSelectedHighResTimer) clearTimeout(canvasSelectedHighResTimer);
    const seq = ++canvasSelectedHighResSeq;
    if(!selectedImages.length || canvasImageEditorIsOpen()) return;
    canvasSelectedHighResTimer = setTimeout(async () => {
        canvasSelectedHighResTimer = 0;
        if(seq !== canvasSelectedHighResSeq || canvasImageEditorIsOpen()) return;
        await Promise.all(selectedImages.map(item => preloadCanvasSelectedHighRes(item.target)));
        if(seq !== canvasSelectedHighResSeq || canvasImageEditorIsOpen()) return;
        selectedImages.forEach(({img, target}) => {
            if(!img.isConnected || img.dataset.selectedHighResTarget !== target) return;
            if(!canvasViewportWantsHighRes() || !canvasImageNearViewport(img)) return;
            if(canvasSelectedHighResLoaded.has(target) && img.getAttribute('src') !== target) img.src = target;
        });
    }, CANVAS_SELECTED_HIGH_RES_DELAY);
}
function scheduleCanvasImageResolutionSync(root=nodesEl, delay=120){
    if(canvasImageResolutionSyncTimer) clearTimeout(canvasImageResolutionSyncTimer);
    canvasImageResolutionSyncTimer = setTimeout(() => {
        canvasImageResolutionSyncTimer = 0;
        syncCanvasSelectedImageResolution(root);
    }, Math.max(0, Number(delay) || 0));
}
function applyLanguage(lang){
    if(lang && window.StudioI18n) StudioI18n.set(lang);
    document.title = tr('canvas.title');
    refreshGateViewControls();
    if(canvas) {
        currentCanvasTitle.textContent = canvas?.title || tr('canvas.untitled');
    }

    render();
}
async function refreshCanvasConfigFromSettings(){
    return CanvasProviderConfig.refreshCanvasConfigFromSettings(classicProviderConfigHost());
}
window.addEventListener('message', event => {
    if(event.origin && event.origin !== location.origin) return;
    if(event.data?.type === 'studio-lang') applyLanguage(event.data.lang);
    if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);
    if(event.data?.type === 'providers-changed' || event.data?.type === 'workflows-changed' || event.data?.type === 'comfy-instances-changed'){
        refreshCanvasConfigFromSettings();
    }
    if(event.data?.type === 'canvas-focus'){
        // 从其他标签页切换回画布时，重新拉取工作流列表并刷新节点
        refreshCanvasConfigFromSettings();
        if(canvas) syncRemoteCanvasNow();
    }
});
window.addEventListener('studio-lang-change', () => {
    document.title = tr('canvas.title');
    refreshGateViewControls();
    if(canvas) currentCanvasTitle.textContent = canvas?.title || tr('canvas.untitled');

    render();
});
const shell = document.getElementById('shell');
const canvasGate = document.getElementById('canvasGate');
const board = document.getElementById('board');
const world = document.getElementById('world');
const nodesEl = document.getElementById('nodes');
const minimap = document.getElementById('minimap');
const minimapContent = document.getElementById('minimapContent');
const canvasArrangeBtn = document.getElementById('canvasArrangeBtn');
let minimapViewport = document.getElementById('minimapViewport');
const linksEl = document.getElementById('links');
const linkControlsEl = document.getElementById('linkControls');
const dropOverlay = document.getElementById('dropOverlay');
const createMenu = document.getElementById('createMenu');
const linkCreateMenu = document.getElementById('linkCreateMenu');
const nodeInputMenu = document.getElementById('nodeInputMenu');
const nodeOutputMenu = document.getElementById('nodeOutputMenu');
const imageNodeMenu = document.getElementById('imageNodeMenu');
const selectionBox = document.getElementById('selectionBox');
const selectionHub = document.getElementById('selectionHub');
const gateStatus = document.getElementById('gateStatus');
const gateCreateBtn = document.getElementById('gateCreateBtn');
const gateCreateSmartBtn = document.getElementById('gateCreateSmartBtn');
const gateRefreshBtn = document.getElementById('gateRefreshBtn');
const gateBackBtn = document.getElementById('gateBackBtn');
const gateTrashBtn = document.getElementById('gateTrashBtn');
const gateAssetManagerBtn = document.getElementById('gateAssetManagerBtn');
const gateTrashCount = document.getElementById('gateTrashCount');
const gateTitleText = document.getElementById('gateTitleText');
const gateSubtitle = document.getElementById('gateSubtitle');
const gateCanvasList = document.getElementById('gateCanvasList');
const gateTitleInput = document.getElementById('gateTitleInput');
const gateConfirmBtn = document.getElementById('gateConfirmBtn');
const gateCancelBtn = document.getElementById('gateCancelBtn');
const backToManagerBtn = document.getElementById('backToManagerBtn');
const clearCurrentCanvasBtn = document.getElementById('clearCurrentCanvasBtn');
const currentCanvasTitle = document.getElementById('currentCanvasTitle');
const currentCanvasTime = document.getElementById('currentCanvasTime');
const outputLightbox = document.getElementById('outputLightbox');
const outputPreview = document.getElementById('outputPreview');
const outputLightboxImg = document.getElementById('outputLightboxImg');
const outputCompareContainer = document.getElementById('outputCompareContainer');
const outputCompareResult = document.getElementById('outputCompareResult');
const outputCompareOriginal = document.getElementById('outputCompareOriginal');
const outputCompareOriginalWrap = document.getElementById('outputCompareOriginalWrap');
const outputCompareSlider = document.getElementById('outputCompareSlider');
const outputResolution = document.getElementById('outputResolution');
const outputDownloadBtn = document.getElementById('outputDownloadBtn');
const outputDownloadAllBtn = document.getElementById('outputDownloadAllBtn');
const outputLightboxVideo = document.getElementById('outputLightboxVideo');
const outputPromptPanel = document.getElementById('outputPromptPanel');
const outputPromptText = document.getElementById('outputPromptText');
const outputCopyPromptBtn = document.getElementById('outputCopyPromptBtn');
const outputRerunBtn = document.getElementById('outputRerunBtn');
const promptTemplateModal = document.getElementById('promptTemplateModal');
const promptTemplatePanel = document.getElementById('promptTemplatePanel') || promptTemplateModal?.querySelector('.prompt-template-panel');
const promptTemplateClose = document.getElementById('promptTemplateClose');
const promptTemplateSearch = document.getElementById('promptTemplateSearch');
const promptTemplateLibrarySelect = document.getElementById('promptTemplateLibrarySelect');
const promptTemplateCats = document.getElementById('promptTemplateCats');
const promptTemplateBody = document.getElementById('promptTemplateBody');
const canvasAssetToggle = document.getElementById('canvasAssetToggle');
const canvasAssetPanel = document.getElementById('canvasAssetPanel');
const canvasAssetCloseBtn = document.getElementById('canvasAssetCloseBtn');
const canvasAssetLibrarySelect = document.getElementById('canvasAssetLibrarySelect');
const canvasAssetCategorySelect = document.getElementById('canvasAssetCategorySelect');
const canvasAssetAddCategoryBtn = document.getElementById('canvasAssetAddCategoryBtn');
const canvasAssetDropZone = document.getElementById('canvasAssetDropZone');
const canvasAssetGrid = document.getElementById('canvasAssetGrid');
const canvasAssetHoverPreview = document.getElementById('canvasAssetHoverPreview');
const workflowTransferToggle = document.getElementById('workflowTransferToggle');
const canvasLogToggle = document.getElementById('canvasLogToggle');
const workflowTransferModal = document.getElementById('workflowTransferModal');
const workflowTransferSub = document.getElementById('workflowTransferSub');
const workflowExportMeta = document.getElementById('workflowExportMeta');
const workflowImportInput = document.getElementById('workflowImportInput');
const workflowImportDropZone = document.getElementById('workflowImportDropZone');
const workflowExportLibraryBtn = document.getElementById('workflowExportLibraryBtn');
const assetManagerModal = document.getElementById('assetManagerModal');
const assetManagerBody = document.getElementById('assetManagerBody');
function revealCanvasAssetControls(){
    [canvasAssetToggle, canvasAssetPanel, assetManagerModal].forEach(el => {
        if(!el) return;
        el.hidden = false;
        if(el.style?.display === 'none') el.style.display = '';
    });
}
revealCanvasAssetControls();
const logModal = document.getElementById('logModal');
const logList = document.getElementById('logList');
const errorModal = document.getElementById('errorModal');
const errorTitle = document.getElementById('errorTitle');
const errorMessage = document.getElementById('errorMessage');
let canvases = [];
let deletedCanvases = [];
let canvas = null;
let canvasOpenGeneration = 0;
let openingCanvasId = '';
let canvasOrphanUnknownSubmissionCount = 0;
let nodes = [];
let connections = [];
let viewport = {x: -1800, y: -1000, scale: 1};
let dragNode = null;
let dragBoard = null;
let minimapDrag = false;
let minimapState = null;
let minimapRenderQueued = false;
let linksRenderQueued = false;
let zoomPreviewState = null;
let resizeNode = null;
let llmPaneDrag = null;
let tempLink = null;
let knifeActive = false;
let knifePoint = null;
let knifeTrail = [];
let knifeChanged = false;
let knifeNeedsRender = false;
let selectDrag = null;
let isRKeyDown = false;
let menuPoint = null;
let linkCreateState = null;
let internalDrag = false;
let selected = new Set();
const classicSaveScheduler = CanvasSaveScheduler.create({save:()=>saveCanvas(),getCanvasId:()=>canvas?.id || null});
let creatingCanvas = false;
let createCanvasKind = 'classic';
let trashMode = false;
let pendingDeleteCanvasId = null;
let pendingPurgeCanvasId = null;


let canvasSortMode = (() => { try { return localStorage.getItem('canvasSortMode') || 'recent'; } catch(e){ return 'recent'; } })();
const CANVAS_LIST_PROJECT_KEY = 'canvasListCurrentProjectId';

// 先绑定返回，避免编辑器后续初始化较慢时丢失来源项目。
backToManagerBtn?.addEventListener('click', returnToCanvasManager);
function classicNavigationHost(){
    return {
        get CLIENT_ID(){return CLIENT_ID;},
        get CanvasSaveTransport(){return CanvasSaveTransport;},
        get backToManagerBtn(){return backToManagerBtn;},
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get classicSaveScheduler(){return classicSaveScheduler;},
        get classicSaveSession(){return classicSaveSession;},
        get clearCurrentCanvasBtn(){return clearCurrentCanvasBtn;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get console(){return console;},
        get currentCanvasTime(){return currentCanvasTime;},
        get lastCanvasUpdatedAt(){return lastCanvasUpdatedAt;},
        set lastCanvasUpdatedAt(value){lastCanvasUpdatedAt=value;},
        get localCanvasDirty(){return localCanvasDirty;},
        set localCanvasDirty(value){localCanvasDirty=value;},
        get localStorage(){return localStorage;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get outputTimer(){return outputTimer;},
        set outputTimer(value){outputTimer=value;},
        get selected(){return selected;},
        get setClassicSaveWarning(){return setClassicSaveWarning;},
        get viewport(){return viewport;},
        set viewport(value){viewport=value;},
        get window(){return window;},
        applyRemoteCanvasData:(...args)=>applyRemoteCanvasData(...args),
        canvasListUrlForProject:(...args)=>canvasListUrlForProject(...args),
        clearInterval:(...args)=>clearInterval(...args),
        fetch:(...args)=>fetch(...args),
        formatCanvasTime:(...args)=>formatCanvasTime(...args),
        loadCanvasList:(...args)=>loadCanvasList(...args),
        localViewportForCanvas:(...args)=>localViewportForCanvas(...args),
        rememberClassicSaveBase:(...args)=>rememberClassicSaveBase(...args),
        rememberedCanvasListProject:(...args)=>rememberedCanvasListProject(...args),
        render:(...args)=>render(...args),
        requestedCanvasListProject:(...args)=>requestedCanvasListProject(...args),
        resetCascadeRuntimeState:(...args)=>resetCascadeRuntimeState(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        setStatus:(...args)=>setStatus(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        unknownCanvasSubmissionKey:(...args)=>unknownCanvasSubmissionKey(...args),
        unsavedCanvasAcceptedTasksKey:(...args)=>unsavedCanvasAcceptedTasksKey(...args)
    };
}
async function returnToCanvasManager(){
    return CanvasNavigation.returnToCanvasManager(classicNavigationHost());
}
clearCurrentCanvasBtn?.addEventListener('click', () => {
    closeCreateMenu();
    clearCurrentCanvas();
});
let localCanvasDirty = false;
const classicSaveSession = CanvasSaveSession.create({clearQueuedOnBegin:true});
let applyingRemoteCanvas = false;
const classicRemoteSync = CanvasRemoteSync.createClassic({
    getState:()=>({id:canvas?.id,hasCanvas:Boolean(canvas),clientId:CLIENT_ID,
        updatedAt:lastCanvasUpdatedAt,metaRevision:canvas?.meta_revision,
        isSaving:classicSaveSession.isSaving,
        hasEdits:localCanvasDirty || classicSaveScheduler.pending || classicSaveSession.queued,
        applying:applyingRemoteCanvas,hidden:document.hidden}),
    request:(...args)=>fetch(...args),
    merge:remote=>mergeRemoteCanvasEdits(remote),apply:remote=>applyRemoteCanvasData(remote),
    scheduleSave:()=>scheduleSave(),status:message=>setStatus(message),
    error:error=>{console.error(error);setStatus('Sync failed');},openError:()=>tr('canvas.openFailed')
});
let lastCanvasUpdatedAt = 0;
window.addEventListener('pagehide',()=>{
    classicTextSelection.suspend();
    classicLegacyGateBindings.suspend();
    canvasOpenGeneration++;
    classicRemoteSync.stop();
});
window.addEventListener('pageshow',event=>{
    if(event.persisted){
        classicTextSelection.resume();
        classicLegacyGateBindings.resume();
    }
    if(event.persisted && openingCanvasId){
        openCanvas(openingCanvasId);
        return;
    }
    if(event.persisted && canvas){
        classicRemoteSync.start();
        classicRemoteSync.syncNow();
    }
});
let models = {gpt:'gpt-image-2', nano:'nano-banana-pro'};
let imageModels = ['gpt-image-2', 'nano-banana-pro'];
let chatModels = ['gpt-4o-mini'];
let videoModels = [];
let msChatModels = [];
let apiProviders = [];
let comfyBackendCount = 1;
let comfyWorkflows = [];
let comfyWorkflowCache = {};
let runningHubWorkflowCache = {};
let managedProviderId = 'comfly';
let localImageModels = [];
let localChatModels = [];
const MS_GEN_MODELS = {
    zimage:    { label: 'ZImage',     modelId: 'Tongyi-MAI/Z-Image-Turbo',            supportsImage: false, endpoint: '/generate'            },
    qwen_edit: { label: 'Qwen Edit',  modelId: 'Qwen/Qwen-Image-Edit-2511',            supportsImage: true,  endpoint: '/api/angle/generate'  },
    klein_edit:{ label: 'Klein',      modelId: 'black-forest-labs/FLUX.2-klein-9B',   supportsImage: true,  endpoint: '/api/ms/generate'     },
    custom:    { label: '自定义', labelKey: 'canvas.custom', modelId: '',                acceptsImage: true,   endpoint: '/api/ms/generate'     }
};
let hasManagedImageModels = false;
let hasManagedChatModels = false;
let outputCompareDrag = false;
let outputPreviewZoom = 1;
let outputPreviewPan = {x: 0, y: 0};
let outputPreviewPanDrag = null;
let currentOutputCompareUrl = '';
let currentOutputMeta = null;
let currentOutputLightboxOutId = '';
let currentOutputLightboxUrl = '';
const missingAssetUrls = new Set();
let outputTimer = null;
let loopContext = null;
let clipboard = null;
let lastImagePasteAt = 0;
let promptTemplateNodeId = '';
let promptTemplateCategory = 'all';
let promptTemplateSelectedId = '';
let promptTemplateQuery = '';
let promptTemplateEditing = false;
let canvasPromptTemplates = [];
let canvasPromptTemplatesLoaded = false;
let canvasAssistantTemplateCallback = null;
let canvasPromptLibraries = [];
let activePromptLibraryId = 'system';
const CANVAS_PROMPT_TEMPLATE_GROUPS_KEY = 'canvas_prompt_template_groups_v1';
const CANVAS_PROMPT_TEMPLATE_OVERRIDES_KEY = 'canvas_prompt_template_overrides';
const CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX = 'canvas_unsaved_accepted_tasks_v1:';
const CANVAS_UNKNOWN_SUBMISSION_PREFIX = 'canvas_unknown_submission_v1:';
let promptTemplateGroups = [];
let promptTemplateGroupEditMode = false;
let canvasPromptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};
let canvasAssetLibrary = {categories:[]};
let canvasAssetLibraryOpen = false;
let activeCanvasAssetLibraryId = '';
let activeCanvasAssetCategoryId = '';
const LOCAL_CANVAS_ASSET_LIBRARY_ID = '__local_assets__';
let localCanvasAssetLibrary = {items:[], tree:null};
let assetManagerTab = 'assets';
let managerSelectedAssetIds = new Set();
let managerSelectedWorkflowIds = new Set();
let managerSelectedPromptIds = new Set();
let activeCanvasWorkflowCategoryId = '';
const activeCanvasTaskPolls = new Set();
const activeCanvasComfyTaskPolls = new Set();
let hoveredConnectionId = '';
let lastMouseBoard = {x: 0, y: 0};
const classicHistory = CanvasHistory.createClassic(classicHistoryHost());
const cascadeRunningIds = new Set();
const cascadeStopIds = new Set();
const cascadeSerialIds = new Set(); // 记录以串行循环模式启动的运行，用于停止按钮
const cascadeContexts = new Map();
let cropState = null;
let cropDrag = null;
let cropAspectPreset = 'free';
let cropAspectRatio = null;
let imageEditMode = 'crop';
let imageEditModeTouched = false;
let imageResizeScale = 0.5;
let editDrawState = null;
let editTextItems = [];
let editTextSelectedId = '';
let editTextDrag = null;
let editTextDirty = false;
let editTextInlineEditor = null;
let editDrawUndoStack = [];
let editDrawRedoStack = [];
const EDIT_DRAW_HISTORY_MAX = 40;
let brushTool = 'free';
let brushLabelCounter = 1;
let gridCustomMode = false;
let gridCustomLines = []; // [{type:'h'|'v', pos:0-1}] 相对图片尺寸的分数位置
let gridCustomOrientation = 'h'; // 当前点击放置方向
let gridCustomHistory = []; // 撤销栈：每次放线前快照
let gridCustomDrag = null; // {index, pointerId}
let imageEditZoom = 1.0;
let imageEditBaseW = 0; // zoom=1 时图片显示宽度
let imageEditBaseH = 0;
const classicTextSelection = CanvasTextSelection.create();
const PROMPT_TEXT_MAX_LENGTH = 20000;
const CLIENT_ID = 'canvas_' + Math.random().toString(36).slice(2);
const ZOOM_PREVIEW_NODE_DEFAULT_SCALE = 1;
const ZOOM_PREVIEW_NODE_MAX_SCALE = 1.15;







const SIZE_MAP = CanvasImageParams.SIZE_MAP;
const API_RATIO_VALUES = CanvasImageParams.API_RATIO_VALUES;
const RES_LONG_SIDE = CanvasImageParams.RES_LONG_SIDE;
const RES_PIXEL_LIMIT = CanvasImageParams.RES_PIXEL_LIMIT;
const CUSTOM_IMAGE_MODELS_KEY = 'canvas_custom_image_models';
const MANAGED_IMAGE_MODELS_KEY = 'canvas_image_models_ordered';
const MANAGED_CHAT_MODELS_KEY = 'canvas_chat_models_ordered';
const CANVAS_THEME_KEY = 'canvas_theme';
const CANVAS_SESSION_VIEWPORTS_KEY = 'canvas_session_viewports_v1';
let canvasSessionViewportFallback = {};
const DEFAULT_VIDEO_MODELS = [
    // Veo
    'veo2', 'veo2-fast', 'veo2-pro',
    'veo3', 'veo3-fast', 'veo3-pro',
    'veo3.1', 'veo3.1-fast', 'veo3.1-quality', 'veo3.1-lite',
    // Sora
    'sora-2', 'sora-2-pro',
    // 通义万相
    'wan2.6-t2v', 'wan2.6-i2v',
    'wan2.5-t2v-preview', 'wan2.5-i2v-preview',
    'wan2.2-t2v-plus', 'wan2.2-i2v-plus', 'wan2.2-i2v-flash',
    // Seedance
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-1-5-pro-251215',
    'doubao-seedance-1-0-pro-250528',
    'doubao-seedance-1-0-lite-t2v-250428',
    'doubao-seedance-1-0-lite-i2v-250428',
];

function uid(prefix='n'){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }
function loadLocalViewportMap(){
    return CanvasViewport.loadLocalViewportMap(classicViewportHost());
}
function localViewportForCanvas(canvasId, fallback={x:0, y:0, scale:1}){
    return CanvasViewport.localViewportForCanvas(classicViewportHost(), canvasId, fallback);
}
function saveLocalViewport(){
    return CanvasViewport.saveLocalViewport(classicViewportHost());
}
function applyTheme(theme){
    const dark = theme === 'dark';
    document.documentElement.classList.toggle('studio-theme-dark', dark);
    document.documentElement.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('studio-theme-dark', dark);
    document.body.classList.toggle('theme-dark', dark);
    shell.classList.toggle('theme-dark', dark);
}
function classicMenuHost(){
    return {
        get CANVAS_GENERATOR_TYPES(){return CANVAS_GENERATOR_TYPES;},
        get CANVAS_IMAGE_OUTPUT_TYPES(){return CANVAS_IMAGE_OUTPUT_TYPES;},
        get CSS(){return CSS;},
        get board(){return board;},
        get createMenu(){return createMenu;},
        get document(){return document;},
        get imageNodeMenu(){return imageNodeMenu;},
        get linkCreateMenu(){return linkCreateMenu;},
        get linkCreateState(){return linkCreateState;},
        set linkCreateState(value){linkCreateState=value;},
        get menuPoint(){return menuPoint;},
        set menuPoint(value){menuPoint=value;},
        get nodeInputMenu(){return nodeInputMenu;},
        get nodeOutputMenu(){return nodeOutputMenu;},
        get nodes(){return nodes;},
        get nodesEl(){return nodesEl;},
        get window(){return window;},
        convertOutputNodeToInputGroup:(...args)=>convertOutputNodeToInputGroup(...args),
        copyOutputNodeToInputGroup:(...args)=>copyOutputNodeToInputGroup(...args),
        createLinkedNode:(...args)=>createLinkedNode(...args),
        downloadOutputNodeImages:(...args)=>downloadOutputNodeImages(...args),
        ensureCanvas:(...args)=>ensureCanvas(...args),
        escapeAttr:(...args)=>escapeAttr(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        isMissingAssetUrl:(...args)=>isMissingAssetUrl(...args),
        mediaKindForNode:(...args)=>mediaKindForNode(...args),
        openCanvasVideoEditor:(...args)=>openCanvasVideoEditor(...args),
        openImageEditor:(...args)=>openImageEditor(...args),
        openImageNodePreview:(...args)=>openImageNodePreview(...args),
        outputDownloadableImageUrls:(...args)=>outputDownloadableImageUrls(...args),
        outputImageUrls:(...args)=>outputImageUrls(...args),
        pickImageForNode:(...args)=>pickImageForNode(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        tr:(...args)=>tr(...args)
    };
}
function classicAssetManagerHost(){
    return {
        get activeCanvasAssetCategoryId(){return activeCanvasAssetCategoryId;},
        set activeCanvasAssetCategoryId(value){activeCanvasAssetCategoryId=value;},
        get activeCanvasAssetLibraryId(){return activeCanvasAssetLibraryId;},
        set activeCanvasAssetLibraryId(value){activeCanvasAssetLibraryId=value;},
        get activeCanvasWorkflowCategoryId(){return activeCanvasWorkflowCategoryId;},
        set activeCanvasWorkflowCategoryId(value){activeCanvasWorkflowCategoryId=value;},
        get activePromptLibraryId(){return activePromptLibraryId;},
        set activePromptLibraryId(value){activePromptLibraryId=value;},
        get assetManagerBody(){return assetManagerBody;},
        get assetManagerModal(){return assetManagerModal;},
        get assetManagerTab(){return assetManagerTab;},
        set assetManagerTab(value){assetManagerTab=value;},
        get canvasAssetLibrary(){return canvasAssetLibrary;},
        set canvasAssetLibrary(value){canvasAssetLibrary=value;},
        get canvasPromptLibraries(){return canvasPromptLibraries;},
        set canvasPromptLibraries(value){canvasPromptLibraries=value;},
        get canvasPromptTemplatesLoaded(){return canvasPromptTemplatesLoaded;},
        set canvasPromptTemplatesLoaded(value){canvasPromptTemplatesLoaded=value;},
        get document(){return document;},
        get managerSelectedAssetIds(){return managerSelectedAssetIds;},
        get managerSelectedPromptIds(){return managerSelectedPromptIds;},
        get managerSelectedWorkflowIds(){return managerSelectedWorkflowIds;},
        get window(){return window;},
        activeCanvasAssetLibrary:(...args)=>activeCanvasAssetLibrary(...args),
        bindAssetManagerUpload:(target,fn)=>classicAssetManagerController.bindUpload(target,fn),
        clearAssetManagerUploads:()=>classicAssetManagerController.clearUploads(),
        activeCanvasMediaCategory:(...args)=>activeCanvasMediaCategory(...args),
        activeCanvasPromptLibrary:(...args)=>activeCanvasPromptLibrary(...args),
        activeCanvasWorkflowCategory:(...args)=>activeCanvasWorkflowCategory(...args),
        bindCanvasPreviewImageFallbacks:(...args)=>bindCanvasPreviewImageFallbacks(...args),
        canvasAssetLibraries:(...args)=>canvasAssetLibraries(...args),
        canvasMediaCategories:(...args)=>canvasMediaCategories(...args),
        canvasPreviewImgHtml:(...args)=>canvasPreviewImgHtml(...args),
        canvasWorkflowCategories:(...args)=>canvasWorkflowCategories(...args),
        downloadBlob:(...args)=>downloadBlob(...args),
        downloadUrl:(...args)=>downloadUrl(...args),
        escapeAttr:(...args)=>escapeAttr(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        loadCanvasAssetLibrary:(...args)=>loadCanvasAssetLibrary(...args),
        loadCanvasPromptTemplates:(...args)=>loadCanvasPromptTemplates(...args),
        refreshCanvasPromptTemplatesFromLibraries:(...args)=>refreshCanvasPromptTemplatesFromLibraries(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        renderCanvasAssetLibrary:(...args)=>renderCanvasAssetLibrary(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        uploadFilesToLibrary:(...args)=>uploadFilesToLibrary(...args)
    };
}

function closeCanvasMoreMenu(){
    return CanvasNodeMenu.closeCanvasMoreMenu(classicMenuHost());
}
function toggleCanvasMoreMenu(){
    return CanvasNodeMenu.toggleCanvasMoreMenu(classicMenuHost());
}
function openCanvasNodeMenu(){
    return CanvasNodeMenu.openCanvasNodeMenu(classicMenuHost());
}
const classicMenuController=CanvasNodeMenu.create(classicMenuHost);
classicMenuController.mount();


function classicProviderConfigHost(){
    return {
        get CUSTOM_IMAGE_MODELS_KEY(){return CUSTOM_IMAGE_MODELS_KEY;},
        get DEFAULT_VIDEO_MODELS(){return DEFAULT_VIDEO_MODELS;},
        get MANAGED_CHAT_MODELS_KEY(){return MANAGED_CHAT_MODELS_KEY;},
        get MANAGED_IMAGE_MODELS_KEY(){return MANAGED_IMAGE_MODELS_KEY;},
        get MS_GEN_MODELS(){return MS_GEN_MODELS;},
        get apiProviders(){return apiProviders;},
        set apiProviders(value){apiProviders=value;},
        get chatModels(){return chatModels;},
        set chatModels(value){chatModels=value;},
        get comfyBackendCount(){return comfyBackendCount;},
        set comfyBackendCount(value){comfyBackendCount=value;},
        get comfyWorkflows(){return comfyWorkflows;},
        set comfyWorkflows(value){comfyWorkflows=value;},
        get hasManagedChatModels(){return hasManagedChatModels;},
        set hasManagedChatModels(value){hasManagedChatModels=value;},
        get hasManagedImageModels(){return hasManagedImageModels;},
        set hasManagedImageModels(value){hasManagedImageModels=value;},
        get imageModels(){return imageModels;},
        set imageModels(value){imageModels=value;},
        get localChatModels(){return localChatModels;},
        set localChatModels(value){localChatModels=value;},
        get localImageModels(){return localImageModels;},
        set localImageModels(value){localImageModels=value;},
        get localStorage(){return localStorage;},
        get managedProviderId(){return managedProviderId;},
        get models(){return models;},
        get msChatModels(){return msChatModels;},
        set msChatModels(value){msChatModels=value;},
        get nodes(){return nodes;},
        get runningHubWorkflowCache(){return runningHubWorkflowCache;},
        set runningHubWorkflowCache(value){runningHubWorkflowCache=value;},
        get videoModels(){return videoModels;},
        set videoModels(value){videoModels=value;},
        ensureRunningHubWorkflow:(...args)=>ensureRunningHubWorkflow(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        pruneMissingComfyWorkflows:(...args)=>pruneMissingComfyWorkflows(...args),
        get render(){return typeof render==='function' ? (...args)=>render(...args) : undefined;},
        tr:(...args)=>tr(...args)
    };
}
function loadLocalModelLists(){
    return CanvasProviderConfig.loadLocalModelLists(classicProviderConfigHost());
}
function uniqueModels(list){
    return CanvasProviderConfig.uniqueModels(classicProviderConfigHost(), list);
}
function defaultApiProviders(){
    return CanvasProviderConfig.defaultApiProviders(classicProviderConfigHost());
}
function isRunningHubProvider(provider){
    return CanvasProviderConfig.isRunningHubProvider(classicProviderConfigHost(), provider);
}
function normalizeProviderId(value){
    return CanvasProviderConfig.normalizeProviderId(classicProviderConfigHost(), value);
}
function imageApiProviders(){
    return CanvasProviderConfig.imageApiProviders(classicProviderConfigHost());
}
function midjourneyApiProviders(){
    return CanvasProviderConfig.midjourneyApiProviders(classicProviderConfigHost());
}
function resolveMidjourneyProviderId(id){
    return CanvasProviderConfig.resolveMidjourneyProviderId(classicProviderConfigHost(), id);
}
function midjourneyProviderOptions(selectedId){
    return CanvasProviderConfig.midjourneyProviderOptions(classicProviderConfigHost(), selectedId);
}
function providerById(id){
    return CanvasProviderConfig.providerById(classicProviderConfigHost(), id);
}
function resolveProviderId(id){
    return CanvasProviderConfig.resolveProviderId(classicProviderConfigHost(), id);
}
function chatApiProviders(){
    return CanvasProviderConfig.chatApiProviders(classicProviderConfigHost());
}
function resolveChatProviderId(id){
    return CanvasProviderConfig.resolveChatProviderId(classicProviderConfigHost(), id);
}
function chatProviderOptions(selectedId){
    return CanvasProviderConfig.chatProviderOptions(classicProviderConfigHost(), selectedId);
}
function providerChatModels(providerId){
    return CanvasProviderConfig.providerChatModels(classicProviderConfigHost(), providerId);
}
function providerAudioAnalysisModels(providerId){
    return CanvasProviderConfig.providerAudioAnalysisModels(classicProviderConfigHost(), providerId);
}
function audioAnalysisApiProviders(){
    return CanvasProviderConfig.audioAnalysisApiProviders(classicProviderConfigHost());
}
function audioAnalysisProviderOptions(selectedId){
    return CanvasProviderConfig.audioAnalysisProviderOptions(classicProviderConfigHost(), selectedId);
}
function audioAnalysisModelOptions(selectedModel, providerId){
    return CanvasProviderConfig.audioAnalysisModelOptions(classicProviderConfigHost(), selectedModel, providerId);
}
function resolveImageProviderId(id){
    return CanvasProviderConfig.resolveImageProviderId(classicProviderConfigHost(), id);
}
function providerOptions(selectedId){
    return CanvasProviderConfig.providerOptions(classicProviderConfigHost(), selectedId);
}
function providerImageModels(providerId){
    return CanvasProviderConfig.providerImageModels(classicProviderConfigHost(), providerId);
}
function sanitizeImageNodeProviderModel(node){
    return CanvasProviderConfig.sanitizeImageNodeProviderModel(classicProviderConfigHost(), node);
}
function videoApiProviders(){
    return CanvasProviderConfig.videoApiProviders(classicProviderConfigHost());
}
function resolveVideoProviderId(id){
    return CanvasProviderConfig.resolveVideoProviderId(classicProviderConfigHost(), id);
}
function videoProviderOptions(selectedId){
    return CanvasProviderConfig.videoProviderOptions(classicProviderConfigHost(), selectedId);
}
function providerVideoModels(providerId){
    return CanvasProviderConfig.providerVideoModels(classicProviderConfigHost(), providerId);
}
function sanitizeVideoNodeProviderModel(node){
    return CanvasProviderConfig.sanitizeVideoNodeProviderModel(classicProviderConfigHost(), node);
}
function videoModelOptions(selectedModel, providerId){
    return CanvasProviderConfig.videoModelOptions(classicProviderConfigHost(), selectedModel, providerId);
}
function allImageModels(providerId){
    return CanvasProviderConfig.allImageModels(classicProviderConfigHost(), providerId);
}
function modelscopeImageModels(selected = ''){
    return CanvasProviderConfig.modelscopeImageModels(classicProviderConfigHost(), selected);
}
function modelscopeImageModelOptions(selectedModel){
    return CanvasProviderConfig.modelscopeImageModelOptions(classicProviderConfigHost(), selectedModel);
}
function currentMsModelId(modelKey, node){
    return CanvasProviderConfig.currentMsModelId(classicProviderConfigHost(), modelKey, node);
}
function modelscopeLorasForModel(modelId){
    return CanvasProviderConfig.modelscopeLorasForModel(classicProviderConfigHost(), modelId);
}
function modelscopeLoraOptions(loras, selectedId){
    return CanvasProviderConfig.modelscopeLoraOptions(classicProviderConfigHost(), loras, selectedId);
}
function allChatModels(){
    return CanvasProviderConfig.allChatModels(classicProviderConfigHost());
}
function resolveImageModel(value){
    return CanvasProviderConfig.resolveImageModel(classicProviderConfigHost(), value);
}
function classicNodeParamsHost(){
    return {
        apiImageSize:(...args)=>apiImageSize(...args),
        getImageDimensions:(...args)=>getImageDimensions(...args),
        isGptImageAutoSizeModel:(...args)=>isGptImageAutoSizeModel(...args),
        parseRatioValue:(...args)=>parseRatioValue(...args),
        parseSizeValue:(...args)=>parseSizeValue(...args),
        resolveImageModel:(...args)=>resolveImageModel(...args)
    };
}
function isGptImageAutoSizeModel(model){
    return CanvasImageParams.isGptImageAutoSizeModel(classicNodeParamsHost(), model);
}
function defaultApiImageResolution(model){
    return ClassicNodeParams.defaultApiImageResolution(classicNodeParamsHost(), model);
}
function normalizedImageQuality(value){
    return ClassicNodeParams.normalizedImageQuality(classicNodeParamsHost(), value);
}
function resolveChatModel(value, providerId=''){
    return CanvasProviderConfig.resolveChatModel(classicProviderConfigHost(), value, providerId);
}
function showErrorModal(message, title=tr('canvas.generationFailed')){
    if(!errorModal || !errorMessage){
        alert(message || title);
        return;
    }
    errorTitle.textContent = title || tr('canvas.generationFailed');
    errorMessage.textContent = message || title;
    errorModal.classList.add('open');
    refreshIcons();
}
function canvasBrowserUtilityHost(){
    return {
        apiErrorMessage:(...args)=>apiErrorMessage(...args),
        get document(){return document;},
        get navigator(){return navigator;},
        get window(){return window;},
        copyTextWithCopyEvent:(...args)=>copyTextWithCopyEvent(...args),
        copyTextWithTextarea:(...args)=>copyTextWithTextarea(...args),
        clipboardMatchesText:(...args)=>clipboardMatchesText(...args)
    };
}
function apiErrorMessage(data, fallback='请求失败'){
    return CanvasBrowserUtilities.apiErrorMessage(canvasBrowserUtilityHost(), data, fallback);
}
async function responseErrorMessage(response, fallback='请求失败'){
    return CanvasBrowserUtilities.responseErrorMessage(canvasBrowserUtilityHost(), response, fallback);
}
function closeErrorModal(){
    if(errorModal) errorModal.classList.remove('open');
}
async function copyErrorMessage(){
    const text = errorMessage?.textContent || '';
    if(!text) return;
    if(!(await copyTextToClipboard(text))){
        const range = document.createRange();
        range.selectNodeContents(errorMessage);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}
function copyTextWithCopyEvent(value){
    return CanvasBrowserUtilities.copyTextWithCopyEvent(canvasBrowserUtilityHost(), value);
}
function copyTextWithTextarea(value){
    return CanvasBrowserUtilities.copyTextWithTextarea(canvasBrowserUtilityHost(), value);
}
async function clipboardMatchesText(value){
    return CanvasBrowserUtilities.clipboardMatchesText(canvasBrowserUtilityHost(), value);
}
async function copyTextToClipboard(text){
    return CanvasBrowserUtilities.copyTextToClipboard(canvasBrowserUtilityHost(), text);
}
function parseRatioValue(value){
    return ClassicNodeParams.parseRatioValue(classicNodeParamsHost(), value);
}
function parseSizeValue(value){
    return OnlineImageSizeRules.parseSizeValue(value);
}
function gcdInt(a, b){
    return ClassicNodeParams.gcdInt(classicNodeParamsHost(), a, b);
}
function ratioPartsFromDimensions(width, height){
    return ClassicNodeParams.ratioPartsFromDimensions(classicNodeParamsHost(), width, height);
}
function apiImageSize(ratioValue, resolutionValue, customRatioValue = '', customSizeValue = ''){
    return CanvasImageParams.apiImageSize(classicNodeParamsHost(), ratioValue, resolutionValue, customRatioValue, customSizeValue);
}
function parseSizePair(value){
    return CanvasImageParams.parseSizePair(classicNodeParamsHost(), value);
}
function nearestFourKSizeFor(width, height){
    return CanvasImageParams.nearestFourKSizeFor(classicNodeParamsHost(), width, height);
}
function exceedsFourKStandard(width, height){
    return CanvasImageParams.exceedsFourKStandard(classicNodeParamsHost(), width, height);
}
function normalizeApiNodeSizeChoice(node){
    return ClassicNodeParams.normalizeApiNodeSizeChoice(classicNodeParamsHost(), node);
}
function setCanvasGeneratorSizeFields(node, patch){
    return ClassicNodeParams.setCanvasGeneratorSizeFields(classicNodeParamsHost(), node, patch);
}
function setCanvasMsSizeFields(node, patch){
    return ClassicNodeParams.setCanvasMsSizeFields(classicNodeParamsHost(), node, patch);
}
async function generatorSizeForRun(gen, refs){
    return ClassicNodeParams.generatorSizeForRun(classicNodeParamsHost(), gen, refs);
}
function normalizeApiNodeLayout(node){
    return ClassicNodeParams.normalizeApiNodeLayout(classicNodeParamsHost(), node);
}
function imageModelOptions(selectedModel, providerId){
    if(!imageApiProviders().length){
        return `<option value="" disabled selected>${tr('canvas.noApiProvidersHint') || '暂无 API 平台，请到 API 设置添加'}</option>`;
    }
    const models = allImageModels(providerId);
    if(!models.length){
        return `<option value="" disabled selected>${tr('canvas.noImageModelsHint') || '暂无生图模型，请到 API 设置添加'}</option>`;
    }
    const selectedValue = resolveImageModel(selectedModel);
    const options = models.map(model => `<option value="${escapeHtml(model)}" ${model === selectedValue ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
    const hasSelected = models.includes(selectedValue);
    return `${hasSelected || !selectedValue ? '' : `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`}${options}`;
}
function chatModelOptions(selectedModel, providerId=''){
    const models = providerId ? providerChatModels(providerId) : allChatModels();
    if(!models.length){
        return `<option value="" disabled selected>${tr('canvas.noModelsHint') || '暂无模型，请到 API 设置添加'}</option>`;
    }
    const selectedValue = resolveChatModel(selectedModel, providerId);
    const options = models.map(model => `<option value="${escapeHtml(model)}" ${model === selectedValue ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
    const hasSelected = models.includes(selectedValue);
    return `${hasSelected || !selectedValue ? '' : `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`}${options}`;
}
function formatCanvasTime(value){
    if(!value) return '--';
    const raw = Number(value);
    const time = raw < 10000000000 ? raw * 1000 : raw;
    const date = new Date(time);
    if(Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString(window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function setStatus(text){
    document.getElementById('saveState').textContent = text;
    if(gateStatus) gateStatus.textContent = text;
}
let generationCompleteSoundAt = 0;
function playGenerationCompleteSound(){
    const now = Date.now();
    if(now - generationCompleteSoundAt < 1200) return;
    generationCompleteSoundAt = now;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if(!AudioCtx) return;
        const ctx = playGenerationCompleteSound._ctx || (playGenerationCompleteSound._ctx = new AudioCtx());
        const play = () => {
            const start = ctx.currentTime + 0.015;
            [
                {freq:660, at:0, duration:0.12},
                {freq:880, at:0.12, duration:0.16}
            ].forEach(tone => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(tone.freq, start + tone.at);
                gain.gain.setValueAtTime(0.0001, start + tone.at);
                gain.gain.exponentialRampToValueAtTime(0.075, start + tone.at + 0.018);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + tone.duration);
                osc.connect(gain).connect(ctx.destination);
                osc.start(start + tone.at);
                osc.stop(start + tone.at + tone.duration + 0.02);
            });
        };
        if(ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});
        else play();
    } catch(e) {}
}
function classicDocumentManagementHost(){
    return {
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get canvasGate(){return canvasGate;},
        get canvasOpenGeneration(){return canvasOpenGeneration;},
        set canvasOpenGeneration(value){canvasOpenGeneration=value;},
        get canvasOrphanUnknownSubmissionCount(){return canvasOrphanUnknownSubmissionCount;},
        set canvasOrphanUnknownSubmissionCount(value){canvasOrphanUnknownSubmissionCount=value;},
        get canvasSortMode(){return canvasSortMode;},
        set canvasSortMode(value){canvasSortMode=value;},
        get canvases(){return canvases;},
        set canvases(value){canvases=value;},
        get classicRemoteSync(){return classicRemoteSync;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get console(){return console;},
        get createCanvasKind(){return createCanvasKind;},
        set createCanvasKind(value){createCanvasKind=value;},
        get creatingCanvas(){return creatingCanvas;},
        set creatingCanvas(value){creatingCanvas=value;},
        get currentCanvasTitle(){return currentCanvasTitle;},
        get deletedCanvases(){return deletedCanvases;},
        set deletedCanvases(value){deletedCanvases=value;},
        get document(){return document;},
        get gateCreateBtn(){return gateCreateBtn;},
        get gateCreateSmartBtn(){return gateCreateSmartBtn;},
        get gateBackBtn(){return gateBackBtn;},
        get gateTrashBtn(){return gateTrashBtn;},
        get gateRefreshBtn(){return gateRefreshBtn;},
        get gateConfirmBtn(){return gateConfirmBtn;},
        get gateCancelBtn(){return gateCancelBtn;},
        get gateSubtitle(){return gateSubtitle;},
        get gateTitleInput(){return gateTitleInput;},
        get gateTitleText(){return gateTitleText;},
        get gateTrashCount(){return gateTrashCount;},
        get localStorage(){return localStorage;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get openingCanvasId(){return openingCanvasId;},
        set openingCanvasId(value){openingCanvasId=value;},
        get pendingDeleteCanvasId(){return pendingDeleteCanvasId;},
        set pendingDeleteCanvasId(value){pendingDeleteCanvasId=value;},
        get pendingPurgeCanvasId(){return pendingPurgeCanvasId;},
        set pendingPurgeCanvasId(value){pendingPurgeCanvasId=value;},
        get selected(){return selected;},
        get trashMode(){return trashMode;},
        set trashMode(value){trashMode=value;},
        get viewport(){return viewport;},
        set viewport(value){viewport=value;},
        get window(){return window;},
        fetch:(...args)=>fetch(...args),
        localViewportForCanvas:(...args)=>localViewportForCanvas(...args),
        openCanvas:(...args)=>openCanvas(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        render:(...args)=>render(...args),
        resetCascadeRuntimeState:(...args)=>resetCascadeRuntimeState(...args),
        resetTransientRunState:(...args)=>resetTransientRunState(...args),
        sanitizeConnections:(...args)=>sanitizeConnections(...args),
        setCanvasMode:(...args)=>setCanvasMode(...args),
        setStatus:(...args)=>setStatus(...args),
        tr:(...args)=>tr(...args)
    };
}
function refreshGateViewControls(){
    return CanvasDocumentManagement.refreshGateViewControls(classicDocumentManagementHost());
}
function setCanvasMode(open){
    shell.classList.toggle('no-canvas', !open);
    if(!open){
        nodesEl.innerHTML = '';
        linksEl.innerHTML = '';
        linkControlsEl.innerHTML = '';
        selectionHub.classList.remove('open');
    } else if(currentCanvasTitle) {
        currentCanvasTitle.textContent = canvas?.title || tr('canvas.untitled');
        currentCanvasTime.textContent = formatCanvasTime(canvas?.updated_at || canvas?.created_at);
    }
    refreshIcons();
}
function ensureCanvas(){
    if(canvas) return true;
    setStatus(tr('canvas.needCanvas'));
    return false;
}
function setCreateMode(active, kind='classic'){
    return CanvasDocumentManagement.setCreateMode(classicDocumentManagementHost(), active, kind);
}
function classicLayoutHost(){
    return {
        get CANVAS_GENERATOR_TYPES(){return CANVAS_GENERATOR_TYPES;},
        get board(){return board;},
        get canvas(){return canvas;},
        get connections(){return connections;},
        get document(){return document;},
        get dragBoard(){return dragBoard;},
        set dragBoard(value){dragBoard=value;},
        get dragNode(){return dragNode;},
        set dragNode(value){dragNode=value;},
        get knifeActive(){return knifeActive;},
        set knifeActive(value){knifeActive=value;},
        get knifeChanged(){return knifeChanged;},
        set knifeChanged(value){knifeChanged=value;},
        get knifeNeedsRender(){return knifeNeedsRender;},
        set knifeNeedsRender(value){knifeNeedsRender=value;},
        get knifePoint(){return knifePoint;},
        set knifePoint(value){knifePoint=value;},
        get knifeTrail(){return knifeTrail;},
        set knifeTrail(value){knifeTrail=value;},
        get llmPaneDrag(){return llmPaneDrag;},
        set llmPaneDrag(value){llmPaneDrag=value;},
        get minimapDrag(){return minimapDrag;},
        get nodes(){return nodes;},
        get nodesEl(){return nodesEl;},
        get resizeNode(){return resizeNode;},
        set resizeNode(value){resizeNode=value;},
        get selectDrag(){return selectDrag;},
        set selectDrag(value){selectDrag=value;},
        get selected(){return selected;},
        get selectionBox(){return selectionBox;},
        get tempLink(){return tempLink;},
        set tempLink(value){tempLink=value;},
        endTextSelection:()=>classicTextSelection.endSelection(),
        get viewport(){return viewport;},
        get window(){return window;},
        get workflowTransferModal(){return workflowTransferModal;},
        canConnect:(...args)=>canConnect(...args),
        connectSelectionToGenerator:(...args)=>connectSelectionToGenerator(...args),
        connectedClusterIds:(...args)=>connectedClusterIds(...args),
        defaultNodeSize:(...args)=>defaultNodeSize(...args),
        duplicateNodesForAltDrag:(...args)=>duplicateNodesForAltDrag(...args),
        groupSelectedImages:(...args)=>groupSelectedImages(...args),
        openLinkCreateMenu:(...args)=>openLinkCreateMenu(...args),
        portPoint:(...args)=>portPoint(...args),
        pushUndo:(...args)=>pushUndo(...args),
        render:(...args)=>render(...args),
        renderLinks:(...args)=>renderLinks(...args),
        renderSelectionHub:(...args)=>renderSelectionHub(...args),
        sanitizeConnections:(...args)=>sanitizeConnections(...args),
        scheduleLinksRender:(...args)=>scheduleLinksRender(...args),
        scheduleMinimapRender:(...args)=>scheduleMinimapRender(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        scheduleViewportSave:(...args)=>scheduleViewportSave(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        setKnifeMode:(...args)=>setKnifeMode(...args),
        startKnifeDrag:(...args)=>startKnifeDrag(...args),
        syncGeneratorInputs:(...args)=>syncGeneratorInputs(...args),
        syncLatestGeneratedOutputToConnection:(...args)=>syncLatestGeneratedOutputToConnection(...args),
        uid:(...args)=>uid(...args),
        updateGroupMembership:(...args)=>updateGroupMembership(...args),
        updateWorkflowTransferMeta:(...args)=>updateWorkflowTransferMeta(...args)
    ,
        set connections(value){connections=value;},
        get selectionHub(){return selectionHub;},
        applyViewport:(...args)=>applyViewport(...args),
        closeCreateMenu:(...args)=>closeCreateMenu(...args),
        cubicPoint:(...args)=>cubicPoint(...args),
        endDrag:(...args)=>endDrag(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        nodeBounds:(...args)=>nodeBounds(...args),
        nodeRect:(...args)=>nodeRect(...args),
        pointSegmentDistance:(...args)=>pointSegmentDistance(...args),
        refreshGeneratorInputViews:(...args)=>refreshGeneratorInputViews(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        segmentIntersectsRect:(...args)=>segmentIntersectsRect(...args),
        segmentsIntersect:(...args)=>segmentsIntersect(...args),
        syncCanvasSelectedImageResolution:(...args)=>syncCanvasSelectedImageResolution(...args),
        tr:(...args)=>tr(...args),
        setCanvasMouseMove:(...args)=>setCanvasMouseMove(...args),
        setCanvasMouseUp:(...args)=>setCanvasMouseUp(...args)
    };
}
function screenToWorld(clientX, clientY){
    return CanvasLayout.screenToWorld(classicLayoutHost(), clientX, clientY);
}
function classicViewportHost(){
    return {
        get CANVAS_SESSION_VIEWPORTS_KEY(){return CANVAS_SESSION_VIEWPORTS_KEY;},
        get CSS(){return CSS;},
        get ZOOM_PREVIEW_NODE_DEFAULT_SCALE(){return ZOOM_PREVIEW_NODE_DEFAULT_SCALE;},
        get ZOOM_PREVIEW_NODE_MAX_SCALE(){return ZOOM_PREVIEW_NODE_MAX_SCALE;},
        get board(){return board;},
        get canvas(){return canvas;},
        get canvasArrangeBtn(){return canvasArrangeBtn;},
        get canvasSessionViewportFallback(){return canvasSessionViewportFallback;},
        set canvasSessionViewportFallback(value){canvasSessionViewportFallback=value;},
        get document(){return document;},
        get linksRenderQueued(){return linksRenderQueued;},
        set linksRenderQueued(value){linksRenderQueued=value;},
        get minimapContent(){return minimapContent;},
        get minimapRenderQueued(){return minimapRenderQueued;},
        set minimapRenderQueued(value){minimapRenderQueued=value;},
        get minimapState(){return minimapState;},
        set minimapState(value){minimapState=value;},
        get minimapViewport(){return minimapViewport;},
        set minimapViewport(value){minimapViewport=value;},
        get nodes(){return nodes;},
        get nodesEl(){return nodesEl;},
        get selected(){return selected;},
        get sessionStorage(){return sessionStorage;},
        get shell(){return shell;},
        get viewport(){return viewport;},
        get window(){return window;},
        get world(){return world;},
        get zoomPreviewState(){return zoomPreviewState;},
        set zoomPreviewState(value){zoomPreviewState=value;},
        closeCreateMenu:(...args)=>closeCreateMenu(...args),
        closeLinkCreateMenu:(...args)=>closeLinkCreateMenu(...args),
        defaultNodeSize:(...args)=>defaultNodeSize(...args),
        renderLinks:(...args)=>renderLinks(...args),
        renderSelectionHub:(...args)=>renderSelectionHub(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        scheduleCanvasImageResolutionSync:(...args)=>scheduleCanvasImageResolutionSync(...args)
    };
}
function applyViewport(){
    return CanvasViewport.applyViewport(classicViewportHost());
}
function estimatedNodeRect(n){
    return CanvasViewport.estimatedNodeRect(classicViewportHost(), n);
}
function currentWorldViewRect(){
    return CanvasViewport.currentWorldViewRect(classicViewportHost());
}
function minimapBounds(){
    return CanvasViewport.minimapBounds(classicViewportHost());
}
function scheduleMinimapRender(){
    return CanvasViewport.scheduleMinimapRender(classicViewportHost());
}
// 拖动/缩放节点时每个 mousemove 都全量重建连线 SVG 会掉帧；用 rAF 合并成每帧最多刷新一次。
function scheduleLinksRender(){
    return CanvasViewport.scheduleLinksRender(classicViewportHost());
}
function renderMinimap(){
    return CanvasViewport.renderMinimap(classicViewportHost());
}
function updateMinimapViewport(){
    return CanvasViewport.updateMinimapViewport(classicViewportHost());
}
function minimapEventToWorld(e){
    return CanvasViewport.minimapEventToWorld(classicViewportHost(), e);
}
function centerViewportOnWorldPoint(point){
    return CanvasViewport.centerViewportOnWorldPoint(classicViewportHost(), point);
}
function safeViewportScale(value){
    return CanvasViewport.safeViewportScale(classicViewportHost(), value);
}
function fitAllNodesViewport(){
    return CanvasViewport.fitAllNodesViewport(classicViewportHost());
}
function enterZoomPreview(){
    return CanvasViewport.enterZoomPreview(classicViewportHost());
}
function exitZoomPreview(point=null){
    return CanvasViewport.exitZoomPreview(classicViewportHost(), point);
}
function exitZoomPreviewToNode(nodeId){
    return CanvasViewport.exitZoomPreviewToNode(classicViewportHost(), nodeId);
}
function toggleZoomPreview(){
    return CanvasViewport.toggleZoomPreview(classicViewportHost());
}
function refreshGeometry(){
    return CanvasViewport.refreshGeometry(classicViewportHost());
}
function refreshGeometryAfterLayout(){
    return CanvasViewport.refreshGeometryAfterLayout(classicViewportHost());
}
function classicSaveCoordinatorHost(){
    return {
        get CLIENT_ID(){return CLIENT_ID;},
        get CanvasSaveTransport(){return CanvasSaveTransport;},
        get applyingRemoteCanvas(){return applyingRemoteCanvas;},
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get classicSaveBase(){return classicSaveBase;},
        set classicSaveBase(value){classicSaveBase=value;},
        get classicSaveScheduler(){return classicSaveScheduler;},
        get classicSaveSession(){return classicSaveSession;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get console(){return console;},
        get currentCanvasTime(){return currentCanvasTime;},
        get currentCanvasTitle(){return currentCanvasTitle;},
        get gateCanvasList(){return gateCanvasList;},
        get lastCanvasUpdatedAt(){return lastCanvasUpdatedAt;},
        set lastCanvasUpdatedAt(value){lastCanvasUpdatedAt=value;},
        get localCanvasDirty(){return localCanvasDirty;},
        set localCanvasDirty(value){localCanvasDirty=value;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get setClassicSaveWarning(){return setClassicSaveWarning;},
        get viewport(){return viewport;},
        set viewport(value){viewport=value;},
        get window(){return typeof window==='undefined'?undefined:window;},
        clearUnsavedCanvasAcceptedTasks:(...args)=>clearUnsavedCanvasAcceptedTasks(...args),
        clearUnsavedCanvasUnknownWarnings:(...args)=>clearUnsavedCanvasUnknownWarnings(...args),
        cloneNode:(...args)=>cloneNode(...args),
        fetch:(...args)=>fetch(...args),
        formatCanvasTime:(...args)=>formatCanvasTime(...args),
        loadCanvasList:(...args)=>loadCanvasList(...args),
        mergeCanvasAssistantChanges:(...args)=>mergeCanvasAssistantChanges(...args),
        render:(...args)=>render(...args),
        sanitizeConnections:(...args)=>sanitizeConnections(...args),
        setStatus:(...args)=>setStatus(...args),
        tr:(...args)=>tr(...args)
    };
}
function scheduleSave(){
    return CanvasSaveCoordinator.scheduleSave(classicSaveCoordinatorHost());
}
function scheduleViewportSave(){
    return CanvasViewport.scheduleViewportSave(classicViewportHost());
}
function refreshOutputTimer(){
    const hasPending = nodes.some(n => n.type === 'output' && (n._pending || []).length);
    if(hasPending && !outputTimer){
        outputTimer = setInterval(() => {
            const pendingById = new Map();
            nodes.filter(n => n.type === 'output').forEach(node => {
                (node._pending || []).forEach(p => pendingById.set(p.id, p));
            });
            if(pendingById.size){
                document.querySelectorAll('.output-time-pill.running').forEach(pill => {
                    const pendingId = pill.closest('[data-pending-id]')?.dataset.pendingId;
                    const pending = pendingById.get(pendingId);
                    if(pending) pill.textContent = formatRunDuration(nowMs() - Number(pending.startedAt || nowMs()));
                });
            } else {
                clearInterval(outputTimer);
                outputTimer = null;
            }
        }, 1000);
    } else if(!hasPending && outputTimer){
        clearInterval(outputTimer);
        outputTimer = null;
    }
}
function serializableCanvasNode(node){
    return CanvasSaveCoordinator.serializableCanvasNode(classicSaveCoordinatorHost(), node);
}
function serializableCanvasNodes(list=nodes){
    return CanvasSaveCoordinator.serializableCanvasNodes(classicSaveCoordinatorHost(), list);
}
let classicSaveBase = null;
function classicDraftSnapshot(){
    return CanvasSaveCoordinator.classicDraftSnapshot(classicSaveCoordinatorHost());
}
function classicConflictCopy(node){
    return CanvasSaveCoordinator.classicConflictCopy(classicSaveCoordinatorHost(), node);
}
function rememberClassicSaveBase(remote){
    return CanvasSaveCoordinator.rememberClassicSaveBase(classicSaveCoordinatorHost(), remote);
}
function backupClassicDraft(){
    return CanvasSaveCoordinator.backupClassicDraft(classicSaveCoordinatorHost());
}
function setClassicSaveWarning(message=''){
    const warning = document.getElementById('canvasSaveError');
    if(!warning) return;
    warning.hidden = !message;
    const text = warning.querySelector('span');
    if(text) text.textContent = message;
}
function retryCanvasSave(){ setClassicSaveWarning.conflict = false; saveCanvas(); }
function mergeRemoteCanvasEdits(remote){
    return CanvasSaveCoordinator.mergeRemoteCanvasEdits(classicSaveCoordinatorHost(), remote);
}
function restoreClassicDraft(){
    return CanvasSaveCoordinator.restoreClassicDraft(classicSaveCoordinatorHost());
}
async function saveCanvas(){
    return CanvasSaveCoordinator.saveCanvas(classicSaveCoordinatorHost());
}

async function loadConfig(){
    return CanvasProviderConfig.loadConfig(classicProviderConfigHost());
}

// 监听 API 设置页面的变更广播，实时刷新画布的模型/平台下拉
try {
    const apiChannel = new BroadcastChannel('studio-api');
    apiChannel.onmessage = async (e) => {
        if(e.data?.type === 'providers-changed' || e.data?.type === 'workflows-changed' || e.data?.type === 'comfy-instances-changed'){
            await refreshCanvasConfigFromSettings();
        }
    };
} catch(e) { /* 不支持 BroadcastChannel 的旧浏览器忽略 */ }
function msChatModelOptions(selected){
    return CanvasProviderConfig.msChatModelOptions(classicProviderConfigHost(), selected);
}
async function loadCanvasList(openFirst=true){
    return CanvasDocumentManagement.loadCanvasList(classicDocumentManagementHost(), openFirst);
}
async function loadTrashList(){
    return CanvasDocumentManagement.loadTrashList(classicDocumentManagementHost());
}
async function refreshTrashCount(){
    return CanvasDocumentManagement.refreshTrashCount(classicDocumentManagementHost());
}
async function setTrashMode(active){
    return CanvasDocumentManagement.setTrashMode(classicDocumentManagementHost(), active);
}

function compareCanvasRecords(a, b){
    return CanvasDocumentManagement.compareCanvasRecords(classicDocumentManagementHost(), a, b);
}
function sortCanvasListByUpdated(){
    return CanvasDocumentManagement.sortCanvasListByUpdated(classicDocumentManagementHost());
}
function setCanvasSortMode(mode){
    return CanvasDocumentManagement.setCanvasSortMode(classicDocumentManagementHost(), mode);
}
async function patchCanvasMeta(id, patch){
    return CanvasDocumentManagement.patchCanvasMeta(classicDocumentManagementHost(), id, patch);
}



function updateCanvasListRecord(record){
    return CanvasDocumentManagement.updateCanvasListRecord(classicDocumentManagementHost(), record);
}
async function touchCanvasOpened(id,isCurrent=()=>true){
    return CanvasDocumentManagement.touchCanvasOpened(classicDocumentManagementHost(), id, isCurrent);
}




async function createCanvas(){
    return CanvasDocumentManagement.createCanvas(classicDocumentManagementHost());
}
async function createSmartCanvas(){
    return CanvasDocumentManagement.createSmartCanvas(classicDocumentManagementHost());
}
function openSmartCanvasPage(id){
    return CanvasDocumentManagement.openSmartCanvasPage(classicDocumentManagementHost(), id);
}




function classicOpenCoordinatorHost(){
    return {
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get canvasOpenGeneration(){return canvasOpenGeneration;},
        set canvasOpenGeneration(value){canvasOpenGeneration=value;},
        get classicRemoteSync(){return classicRemoteSync;},
        get classicSaveBase(){return classicSaveBase;},
        get classicSaveScheduler(){return classicSaveScheduler;},
        get classicSaveSession(){return classicSaveSession;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get console(){return console;},
        get lastCanvasUpdatedAt(){return lastCanvasUpdatedAt;},
        set lastCanvasUpdatedAt(value){lastCanvasUpdatedAt=value;},
        get localCanvasDirty(){return localCanvasDirty;},
        set localCanvasDirty(value){localCanvasDirty=value;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get openingCanvasId(){return openingCanvasId;},
        set openingCanvasId(value){openingCanvasId=value;},
        get selected(){return selected;},
        get viewport(){return viewport;},
        set viewport(value){viewport=value;},
        get window(){return window;},
        canvasListUrlForProject:(...args)=>canvasListUrlForProject(...args),
        classicConflictCopy:(...args)=>classicConflictCopy(...args),
        fetch:(...args)=>fetch(...args),
        localViewportForCanvas:(...args)=>localViewportForCanvas(...args),
        openSmartCanvasPage:(...args)=>openSmartCanvasPage(...args),
        pruneMissingComfyWorkflows:(...args)=>pruneMissingComfyWorkflows(...args),
        refreshMissingCanvasAssets:(...args)=>refreshMissingCanvasAssets(...args),
        rememberCanvasListProject:(...args)=>rememberCanvasListProject(...args),
        rememberClassicSaveBase:(...args)=>rememberClassicSaveBase(...args),
        rememberedCanvasListProject:(...args)=>rememberedCanvasListProject(...args),
        render:(...args)=>render(...args),
        requestedCanvasListProject:(...args)=>requestedCanvasListProject(...args),
        resetCascadeRuntimeState:(...args)=>resetCascadeRuntimeState(...args),
        resetTransientRunState:(...args)=>resetTransientRunState(...args),
        restoreClassicDraft:(...args)=>restoreClassicDraft(...args),
        restoreUnsavedCanvasAcceptedTasks:(...args)=>restoreUnsavedCanvasAcceptedTasks(...args),
        restoreUnsavedCanvasUnknownWarnings:(...args)=>restoreUnsavedCanvasUnknownWarnings(...args),
        resumeCanvasAudioTasks:(...args)=>resumeCanvasAudioTasks(...args),
        resumeCanvasImageTasks:(...args)=>resumeCanvasImageTasks(...args),
        sanitizeConnections:(...args)=>sanitizeConnections(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        setCanvasMode:(...args)=>setCanvasMode(...args),
        setClassicSaveWarning:(...args)=>setClassicSaveWarning(...args),
        setStatus:(...args)=>setStatus(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        startCanvasRemotePolling:(...args)=>startCanvasRemotePolling(...args),
        touchCanvasOpened:(...args)=>touchCanvasOpened(...args),
        tr:(...args)=>tr(...args),
        updateCanvasListRecord:(...args)=>updateCanvasListRecord(...args)
    };
}
async function openCanvas(id){
    return CanvasOpenCoordinator.openCanvas(classicOpenCoordinatorHost(), id);
}
function classicRemoteApplicationHost(){
    return {
        get applyingRemoteCanvas(){return applyingRemoteCanvas;},
        set applyingRemoteCanvas(value){applyingRemoteCanvas=value;},
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get classicRemoteSync(){return classicRemoteSync;},
        get classicSaveScheduler(){return classicSaveScheduler;},
        get classicSaveSession(){return classicSaveSession;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get currentCanvasTime(){return currentCanvasTime;},
        get currentCanvasTitle(){return currentCanvasTitle;},
        get lastCanvasUpdatedAt(){return lastCanvasUpdatedAt;},
        set lastCanvasUpdatedAt(value){lastCanvasUpdatedAt=value;},
        get localCanvasDirty(){return localCanvasDirty;},
        set localCanvasDirty(value){localCanvasDirty=value;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selected(){return selected;},
        set selected(value){selected=value;},
        get viewport(){return viewport;},
        set viewport(value){viewport=value;},
        get window(){return window;},
        formatCanvasTime:(...args)=>formatCanvasTime(...args),
        localViewportForCanvas:(...args)=>localViewportForCanvas(...args),
        pruneMissingComfyWorkflows:(...args)=>pruneMissingComfyWorkflows(...args),
        refreshMissingCanvasAssets:(...args)=>refreshMissingCanvasAssets(...args),
        rememberClassicSaveBase:(...args)=>rememberClassicSaveBase(...args),
        render:(...args)=>render(...args),
        resetCascadeRuntimeState:(...args)=>resetCascadeRuntimeState(...args),
        resumeCanvasAudioTasks:(...args)=>resumeCanvasAudioTasks(...args),
        resumeCanvasImageTasks:(...args)=>resumeCanvasImageTasks(...args),
        sanitizeConnections:(...args)=>sanitizeConnections(...args),
        setStatus:(...args)=>setStatus(...args),
        tr:(...args)=>tr(...args)
    };
}
function applyRemoteCanvasData(remote){
    return CanvasRemoteApplication.applyRemoteCanvasData(classicRemoteApplicationHost(), remote);
}
function resetTransientRunState(list=nodes){
    return CanvasRemoteApplication.resetTransientRunState(classicRemoteApplicationHost(), list);
}
function canvasLocalAssetUrls(nodeList=nodes, logList=canvas?.logs || []){
    const urls = new Set();
    const add = value => {
        const url = outputUrlValue(value);
        if(url && (url.startsWith('/output/') || url.startsWith('/assets/') || url.startsWith('/api/storage-files/'))) urls.add(url);
    };
    nodeList.forEach(node => {
        (window.CanvasClipHost?.collectUrls(node) || []).forEach(add);
        (window.CanvasVideoDeconstructionBridge?.collectUrls(node) || []).forEach(add);
        if(node.url) add(node.url);
        (node.images || []).forEach(add);
        (node.generatedOutputs || []).forEach(add);
        Object.entries(node.imageComparisons || {}).forEach(([key, value]) => {
            add(key);
            add(value);
        });
    });
    logList.forEach(log => {
        (log.outputs || []).forEach(add);
        (log.refs || []).forEach(add);
        (log.run?.refs || []).forEach(add);
    });
    return [...urls];
}
async function refreshMissingCanvasAssets(){
    const isCurrent=classicMediaInputController.capture();
    if(!isCurrent()) return;
    missingAssetUrls.clear();
    const urls = canvasLocalAssetUrls();
    if(!urls.length) return;
    try {
        const data = await fetch('/api/canvas-assets/check', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({urls})
        }).then(r => r.json());
        if(!isCurrent()) return;
        const exists = data.exists || {};
        Object.entries(exists).forEach(([url, ok]) => { if(!ok) missingAssetUrls.add(url); });
    } catch(e) {
        console.warn('canvas asset check failed', e);
    }
}
async function syncRemoteCanvasNow(){ return classicRemoteSync.syncNow(); }
function startCanvasRemotePolling(){ classicRemoteSync.start(); }
function handleCanvasUpdatedMessage(data){ classicRemoteSync.handleMessage(data); }
async function clearCurrentCanvas(){
    return CanvasNavigation.clearCurrentCanvas(classicNavigationHost());
}
function requestDeleteCanvas(id, event){
    return CanvasDocumentManagement.requestDeleteCanvas(classicDocumentManagementHost(), id, event);
}
function requestPurgeCanvas(id, event){
    return CanvasDocumentManagement.requestPurgeCanvas(classicDocumentManagementHost(), id, event);
}
function cancelDeleteCanvas(event){
    return CanvasDocumentManagement.cancelDeleteCanvas(classicDocumentManagementHost(), event);
}
async function deleteCanvas(id, event){
    return CanvasDocumentManagement.deleteCanvas(classicDocumentManagementHost(), id, event);
}
async function restoreCanvas(id, event){
    return CanvasDocumentManagement.restoreCanvas(classicDocumentManagementHost(), id, event);
}
async function purgeCanvas(id, event){
    return CanvasDocumentManagement.purgeCanvas(classicDocumentManagementHost(), id, event);
}
window.createCanvas = createCanvas;
window.createSmartCanvas = createSmartCanvas;
window.loadCanvasList = loadCanvasList;
window.openCanvas = openCanvas;
window.deleteCanvas = deleteCanvas;
window.returnToCanvasManager = returnToCanvasManager;
// Retained gate compatibility has an explicit page lifecycle; canvas-list owns the current list UI.
const classicLegacyGateBindings = CanvasDocumentManagement.createLegacyGateBindings(classicDocumentManagementHost());
classicLegacyGateBindings.resume();

window.addEventListener('studio-theme-change', event => applyTheme(event.detail?.theme || 'light'));
function cropDragModeFromPointer(event){
    return CanvasImageEditor.cropDragModeFromPointer(classicImageEditorHost(), event);
}
function classicImageEditorEventHost(){
    return {
        applyImageEditZoom:(...args)=>applyImageEditZoom(...args),
        beginCropDrag:(...args)=>beginCropDrag(...args),
        beginEditDraw:(...args)=>beginEditDraw(...args),
        beginEditText:(...args)=>beginEditText(...args),
        beginEditTextInline:(...args)=>beginEditTextInline(...args),
        get brushTool(){return brushTool;},
        clampCrop:(...args)=>clampCrop(...args),
        closeImageEditor:(...args)=>closeImageEditor(...args),
        get cropDrag(){return cropDrag;},
        set cropDrag(value){cropDrag=value;},
        cropDragModeFromPointer:(...args)=>cropDragModeFromPointer(...args),
        get cropState(){return cropState;},
        get document(){return document;},
        get editDrawState(){return editDrawState;},
        get editTextDirty(){return editTextDirty;},
        set editTextDirty(value){editTextDirty=value;},
        get editTextDrag(){return editTextDrag;},
        editTextPoint:(...args)=>editTextPoint(...args),
        endEditDraw:(...args)=>endEditDraw(...args),
        endEditText:(...args)=>endEditText(...args),
        get gridCustomDrag(){return gridCustomDrag;},
        hitEditTextItem:(...args)=>hitEditTextItem(...args),
        get imageEditMode(){return imageEditMode;},
        get imageEditZoom(){return imageEditZoom;},
        set imageEditZoom(value){imageEditZoom=value;},
        moveEditDraw:(...args)=>moveEditDraw(...args),
        moveEditText:(...args)=>moveEditText(...args),
        refreshGridSplitPreview:(...args)=>refreshGridSplitPreview(...args),
        renderCropBox:(...args)=>renderCropBox(...args),
        resizeCropFromDrag:(...args)=>resizeCropFromDrag(...args),
        resizeOutpaintFromDrag:(...args)=>resizeOutpaintFromDrag(...args),
        setCropAspectPreset:(...args)=>setCropAspectPreset(...args),
        setImageEditMode:(...args)=>setImageEditMode(...args),
        setImageResizeScale:(...args)=>setImageResizeScale(...args),
        setSelectedEditTextItem:(...args)=>setSelectedEditTextItem(...args),
        syncGridGapValue:(...args)=>syncGridGapValue(...args),
        syncImageEditOverflow:(...args)=>syncImageEditOverflow(...args),
        syncSelectedEditTextStyleFromBrush:(...args)=>syncSelectedEditTextStyleFromBrush(...args),
        get window(){return window;},
    };
}
const classicImageEditorEvents=CanvasImageEditorEvents.create(classicImageEditorEventHost);
classicImageEditorEvents.mount();
function rememberCanvasListProject(projectId){
    const pid = projectId || 'default';
    try { localStorage.setItem(CANVAS_LIST_PROJECT_KEY, pid); } catch(e){}
    return pid;
}

function rememberedCanvasListProject(){
    try { return localStorage.getItem(CANVAS_LIST_PROJECT_KEY) || 'default'; } catch(e){ return 'default'; }
}

function requestedCanvasListProject(){
    try { return new URLSearchParams(window.location.search).get('project') || ''; } catch(e){ return ''; }
}

function canvasListUrlForProject(projectId){
    const pid = rememberCanvasListProject(projectId);
    return `/static/canvas-list.html?project=${encodeURIComponent(pid)}`;
}

function classicNodeEditHost(){
    return {
        get CANVAS_GENERATOR_TYPES(){return CANVAS_GENERATOR_TYPES;},
        get DEFAULT_VIDEO_MODELS(){return DEFAULT_VIDEO_MODELS;},
        get canvas(){return canvas;},
        get clipboard(){return clipboard;},
        set clipboard(value){clipboard=value;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get document(){return document;},
        get hoveredConnectionId(){return hoveredConnectionId;},
        set hoveredConnectionId(value){hoveredConnectionId=value;},
        get lastMouseBoard(){return lastMouseBoard;},
        get linkCreateState(){return linkCreateState;},
        get menuPoint(){return menuPoint;},
        get models(){return models;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selected(){return selected;},
        get videoModels(){return videoModels;},
        get window(){return window;},
        allImageModels:(...args)=>allImageModels(...args),
        canConnect:(...args)=>canConnect(...args),
        chatApiProviders:(...args)=>chatApiProviders(...args),
        closeCreateMenu:(...args)=>closeCreateMenu(...args),
        closeLinkCreateMenu:(...args)=>closeLinkCreateMenu(...args),
        defaultApiImageResolution:(...args)=>defaultApiImageResolution(...args),
        defaultPoint:(...args)=>defaultPoint(...args),
        ensureCanvas:(...args)=>ensureCanvas(...args),
        imageApiProviders:(...args)=>imageApiProviders(...args),
        modelscopeImageModels:(...args)=>modelscopeImageModels(...args),
        nodeBounds:(...args)=>nodeBounds(...args),
        nodeRect:(...args)=>nodeRect(...args),
        providerVideoModels:(...args)=>providerVideoModels(...args),
        pushUndo:(...args)=>pushUndo(...args),
        refreshGeneratorInputViews:(...args)=>refreshGeneratorInputViews(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        remapCanvasDepthCopies:(...args)=>remapCanvasDepthCopies(...args),
        render:(...args)=>render(...args),
        resolveChatModel:(...args)=>resolveChatModel(...args),
        resolveMidjourneyProviderId:(...args)=>resolveMidjourneyProviderId(...args),
        sanitizeConnections:(...args)=>sanitizeConnections(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        serializableCanvasNode:(...args)=>serializableCanvasNode(...args),
        serializableCanvasNodes:(...args)=>serializableCanvasNodes(...args),
        syncGeneratorInputs:(...args)=>syncGeneratorInputs(...args),
        syncLatestGeneratedOutputToConnection:(...args)=>syncLatestGeneratedOutputToConnection(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args),
        validStoryConnection:(...args)=>validStoryConnection(...args),
        videoApiProviders:(...args)=>videoApiProviders(...args)
    };
}
function addNode(node){
    return CanvasNodeEdit.addNode(classicNodeEditHost(), node);
}
function defaultPoint(dx=0, dy=0){ return screenToWorld(window.innerWidth / 2 + dx, window.innerHeight / 2 + dy); }
function addImageNode(point){
    return CanvasNodeEdit.addImageNode(classicNodeEditHost(), point);
}
function addClipNode(point){
    return CanvasNodeEdit.addClipNode(classicNodeEditHost(), point);
}
function addPromptNode(point){
    return CanvasNodeEdit.addPromptNode(classicNodeEditHost(), point);
}
function addLoopNode(point){
    return CanvasNodeEdit.addLoopNode(classicNodeEditHost(), point);
}
function addGroupNode(point){
    return CanvasNodeEdit.addGroupNode(classicNodeEditHost(), point);
}
function pickMediaForNode(nodeId){
    return CanvasUploadCoordination.pickMediaForNode(classicUploadHost(), nodeId);
}
function addLLMNode(point){
    return CanvasNodeEdit.addLLMNode(classicNodeEditHost(), point);
}
function addGeneratorNode(point){
    return CanvasNodeEdit.addGeneratorNode(classicNodeEditHost(), point);
}
function addMidjourneyNode(point){
    return CanvasNodeEdit.addMidjourneyNode(classicNodeEditHost(), point);
}
function addMsGenNode(point){
    return CanvasNodeEdit.addMsGenNode(classicNodeEditHost(), point);
}
function addVideoNode(point){
    return CanvasNodeEdit.addVideoNode(classicNodeEditHost(), point);
}

function addRhNode(point){
    return CanvasNodeEdit.addRhNode(classicNodeEditHost(), point);
}


async function getImageDimensions(url){
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({width: img.naturalWidth, height: img.naturalHeight});
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
    });
}
async function urlToBase64(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error('图片读取失败');
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
function renderMsGenBody(node){
    return CanvasGenerationView.renderMsGenBody(classicNodeViewHost(), node);
}
async function runCanvasAssistantCatalogImage(nodeId, opts){
    const node=nodes.find(n=>n.id===nodeId),config=opts.assistantImageConfig,run=node?.assistantNativeRun;
    if(!node||!['msgen','midjourney'].includes(node.type)||!config||run?.actionId!==opts.assistantNativeActionId)throw new Error('原魔搭或Midjourney运行配置不可用');
    const out=nodes.find(n=>n.id===opts.assistantOutputNodeId&&n.type==='output');
    const validate=()=>{if(canvas?.id!==opts.assistantCanvasId||canvas?.readOnly||!nodes.includes(node)||!nodes.includes(out)||node.outputEnabled!==true||node.count!==1||run.actionId!==opts.assistantNativeActionId||connections.filter(c=>c.from===node.id&&nodes.some(n=>n.id===c.to&&n.type==='output')).length!==1||!connections.some(c=>c.from===node.id&&c.to===out.id))throw new Error('原画布、节点或唯一输出已变化');};
    validate();
    const sources=orderedSources(node,generatorSources(node)),refs=imageRefsOnly(sources.flatMap(s=>s.refs||[])),prompt=sources.map(s=>s.prompt).filter(Boolean).join('\n\n').trim();
    const snapshot=runSnapshot(node,prompt,refs),pending=makePendingForRun(uid('p'),snapshot,node,{refs,requestSize:config.size}, {canvasTaskType:'online-image',providerId:config.provider,model:config.model,assistantNativeActionId:opts.assistantNativeActionId,assistantCanvasId:opts.assistantCanvasId,assistantInputHash:opts.assistantRunInputHash,assistantOutputNodeId:out.id,assistantCatalogImage:true});
    Object.assign(run,{inputHash:opts.assistantRunInputHash,outputNodeId:out.id});
    let submitted=false;
    try{
        await opts.beforeSubmit();validate();
        if(!await saveCanvas())throw new Error('提交开始状态未保存，未提交原任务');
        await opts.beforeSubmit();validate();submitted=true;
        const task=await createCanvasImageTask({prompt:prompt||'Blend connected images.',provider_id:config.provider,model:config.model,size:config.size||'1024x1024',n:1,reference_images:refs,canvas_id:opts.assistantCanvasId,node_id:node.id,assistant_action_id:opts.assistantNativeActionId,input_hash:opts.assistantRunInputHash,native_node_type:node.type,native_configuration_hash:config.configurationHash});
        run.taskIds=[task.task_id];pending.canvasTaskId=task.task_id;pending.queryRecoverable=true;
        out._pending=[...(out._pending||[]),pending];rememberUnsavedCanvasAcceptedTasks(node,[pending],out);
        if(!await saveCanvas())throw pauseCanvasAcceptedTasksUntilSaved(node,[pending],out);
        refreshRunNodes(node,out);await pollCanvasImageTask(task.task_id);
        if(!await saveCanvas())throw new Error('原任务结果尚未保存，请只重试保存和查询');
    }catch(error){
        run.knownRejected=!submitted||error.submissionKnownRejected===true;
        if(run.knownRejected)run.submissionStarted=false;
        else if(!run.taskIds.length){run.unknownCount=1;node.submissionUnknown=true;}
        run.error=error.message;await saveCanvas();throw error;
    }
}

function validateCanvasAssistantCatalogTask(pending,task){
    if(!pending?.assistantCatalogImage)return;
    const binding={canvas_id:pending.assistantCanvasId,node_id:pending.run?.node?.id,assistant_action_id:pending.assistantNativeActionId,input_hash:pending.assistantInputHash,provider_id:pending.providerId,model:pending.model};
    if(Object.entries(binding).some(([k,v])=>task[k]!==v)){const error=new Error('原魔搭或Midjourney任务归属不同，只保留原编号');error.queryPaused=true;throw error;}
}

function classicProviderHost(){
    return {
        get CANVAS_REFERENCE_IMAGE_MAX(){return CANVAS_REFERENCE_IMAGE_MAX;},
        get CLIENT_ID(){return CLIENT_ID;},
        get MS_GEN_MODELS(){return MS_GEN_MODELS;},
        get connections(){return connections;},
        get nodes(){return nodes;},
        addGenerationLog:(...args)=>addGenerationLog(...args),
        alert:(...args)=>alert(...args),
        apiImageSize:(...args)=>apiImageSize(...args),
        appendOutputImages:(...args)=>appendOutputImages(...args),
        cascadeAbortError:(...args)=>cascadeAbortError(...args),
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeStopMessage:(...args)=>cascadeStopMessage(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        collectRunMeta:(...args)=>collectRunMeta(...args),
        collectRunMetas:(...args)=>collectRunMetas(...args),
        confirmCanvasUnknownResubmission:(...args)=>confirmCanvasUnknownResubmission(...args),
        currentMsModelId:(...args)=>currentMsModelId(...args),
        ensureCascadeActive:(...args)=>ensureCascadeActive(...args),
        ensureRhNodeSelection:(...args)=>ensureRhNodeSelection(...args),
        ensureRunningHubWorkflowConfigForNode:(...args)=>ensureRunningHubWorkflowConfigForNode(...args),
        generatorSizeForRun:(...args)=>generatorSizeForRun(...args),
        generatorSources:(...args)=>generatorSources(...args),
        imageRefsOnly:(...args)=>imageRefsOnly(...args),
        isCascadeAbortError:(...args)=>isCascadeAbortError(...args),
        makePendingForRun:(...args)=>makePendingForRun(...args),
        mergeGeneratedOutputs:(...args)=>mergeGeneratedOutputs(...args),
        modelscopeImageModels:(...args)=>modelscopeImageModels(...args),
        modelscopeLorasForModel:(...args)=>modelscopeLorasForModel(...args),
        normalizedImageQuality:(...args)=>normalizedImageQuality(...args),
        nowMs:(...args)=>nowMs(...args),
        orderedSources:(...args)=>orderedSources(...args),
        outputForNode:(...args)=>outputForNode(...args),
        parseSizeValue:(...args)=>parseSizeValue(...args),
        pauseCanvasAcceptedTasksUntilSaved:(...args)=>pauseCanvasAcceptedTasksUntilSaved(...args),
        pendingById:(...args)=>pendingById(...args),
        pollCanvasImageTask:(...args)=>pollCanvasImageTask(...args),
        refreshRunNodes:(...args)=>refreshRunNodes(...args),
        rememberCanvasSubmissionWarning:(...args)=>rememberCanvasSubmissionWarning(...args),
        rememberUnsavedCanvasAcceptedTasks:(...args)=>rememberUnsavedCanvasAcceptedTasks(...args),
        requestMetaFromResult:(...args)=>requestMetaFromResult(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        rhActiveFields:(...args)=>rhActiveFields(...args),
        rhBuildNodeInfoList:(...args)=>rhBuildNodeInfoList(...args),
        rhBuildWorkflowRequestExtras:(...args)=>rhBuildWorkflowRequestExtras(...args),
        rhCurrentKind:(...args)=>rhCurrentKind(...args),
        rhMediaSources:(...args)=>rhMediaSources(...args),
        rhSelectedEntryRef:(...args)=>rhSelectedEntryRef(...args),
        rhUseWallet:(...args)=>rhUseWallet(...args),
        runCanvasAssistantCatalogImage:(...args)=>runCanvasAssistantCatalogImage(...args),
        runSnapshot:(...args)=>runSnapshot(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setTimeout:(...args)=>setTimeout(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        sleep:(...args)=>sleep(...args),
        submitCanvasImageTaskBatch:(...args)=>submitCanvasImageTaskBatch(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args),
        urlToBase64:(...args)=>urlToBase64(...args),
        waitCanvasDirectTasks:(...args)=>waitCanvasDirectTasks(...args)
    };
}
async function runMsGenNode(nodeId, opts={}){
    return CanvasProviderRunner.runMsGenNode(classicProviderHost(), nodeId, opts);
}
function addComfyNode(point){
    return CanvasNodeEdit.addComfyNode(classicNodeEditHost(), point);
}
function addOutputNode(point){
    return CanvasNodeEdit.addOutputNode(classicNodeEditHost(), point);
}
function openCreateMenu(clientX, clientY){
    return CanvasNodeMenu.openCreateMenu(classicMenuHost(), clientX, clientY);
}
function closeCreateMenu(){
    return CanvasNodeMenu.closeCreateMenu(classicMenuHost());
}
function linkCreateOptions(state){
    return CanvasNodeMenu.linkCreateOptions(classicMenuHost(), state);
}
function openLinkCreateMenu(originId, originKind, clientX, clientY){
    return CanvasNodeMenu.openLinkCreateMenu(classicMenuHost(), originId, originKind, clientX, clientY);
}
function openGeneratorNodeMenu(nodeId, clientX, clientY){
    return CanvasNodeMenu.openGeneratorNodeMenu(classicMenuHost(), nodeId, clientX, clientY);
}
function closeLinkCreateMenu(){
    return CanvasNodeMenu.closeLinkCreateMenu(classicMenuHost());
}
function openImageNodeMenu(nodeId, clientX, clientY){
    return CanvasNodeMenu.openImageNodeMenu(classicMenuHost(), nodeId, clientX, clientY);
}
function openImageNodePreview(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node?.url || isMissingAssetUrl(node.url)) return;
    const kind = mediaKindForNode(node);
    if(!['image','video'].includes(kind)) return;
    openOutputLightbox(node.url, node);
}
function canvasDepthPair(node){
    const capture = node?.depthCapture;
    if(!capture) return [];
    return nodes.filter(item => item.depthCapture?.operationId === capture.operationId);
}
function remapCanvasDepthCopies(copies, idMap, preserveExternal=false){
    const operations = new Map();
    copies.forEach(node => {
        delete node.assistantNativeRun;
        delete node.assistantNativeActionId;
        delete node.assistantMediaExportReceipts;
        const capture = node.depthCapture;
        if(!capture) return;
        const oldOperation = capture.operationId || node.id;
        if(!operations.has(oldOperation)) operations.set(oldOperation, CanvasDepthCapture.operationId());
        capture.operationId = operations.get(oldOperation);
        capture.sourceId = idMap.get(capture.sourceId) || (preserveExternal ? capture.sourceId : '');
        capture.taskId = '';
        if(capture.status !== 'succeeded'){
            capture.status = 'failed';
            capture.stage = '复制的任务未继续运行';
            capture.error = capture.sourceId ? '请点击重试' : '原视频未一同复制，请从原视频重新创建';
        }
    });
}
function latestCanvasDepthCapture(sourceId, sourceUrl){
    return nodes.filter(item => item.depthCapture?.sourceId === sourceId && item.depthCapture?.sourceUrl === sourceUrl)
        .sort((a,b) => Number(b.depthCapture.createdAt || 0) - Number(a.depthCapture.createdAt || 0))[0]?.depthCapture || null;
}
function openCanvasVideoEditor(sourceId, sourceUrl, title='视频'){
    const bridge = window.CanvasVideoDeconstructionBridge;
    const source = bridge?.sourceFor(sourceId, sourceUrl, title);
    CanvasDepthCapture.open({sourceUrl, title,
        extensions:source ? {
            onOpenCuts:() => window.CanvasVideoDeconstructionUI.openCuts(source, bridge),
            onOpenTable:() => window.CanvasVideoDeconstructionUI.openTable(source, bridge)
        } : undefined,
        getCurrent:() => latestCanvasDepthCapture(sourceId, sourceUrl) || {},
        onStart:() => startCanvasDepthCapture(sourceId, sourceUrl),
        onRetry:() => {
            const capture = latestCanvasDepthCapture(sourceId, sourceUrl);
            if(capture) return retryCanvasDepthCapture(nodes.find(n => n.depthCapture === capture)?.id);
        },
        onCancel:() => {
            const capture = latestCanvasDepthCapture(sourceId, sourceUrl);
            if(capture) return cancelCanvasDepthCapture(nodes.find(n => n.depthCapture === capture)?.id);
        }
    });
}
function updateCanvasDepthCapture(pair, task, operationId){
    if(!pair.length || pair[0].depthCapture?.operationId !== operationId) return;
    const old = pair[0].depthCapture;
    const state = {...old, taskId:task.id || old.taskId || '', status:task.status || old.status,
        stage:task.stage || old.stage, error:task.error || '', progress:task.progress || 0,
        result_url:task.result_url || old.result_url || '', pose_url:task.pose_url || old.pose_url || '',
        pose_data_url:task.pose_data_url || old.pose_data_url || '',
        detected_frames:task.detected_frames, total_frames:task.total_frames};
    pair.forEach(node => {
        node.depthCapture = {...state, role:node.depthCapture.role};
        if(task.status === 'succeeded'){
            node.url = node.depthCapture.role === 'pose' ? state.pose_url : state.result_url;
            node.mediaKind = 'video';
            node.name = node.depthCapture.role === 'pose' ? '骨骼姿态参考' : '灰度深度参考';
        }
    });
    refreshNodes(pair.map(node => node.id));
    CanvasDepthCapture.update();
    if(old.taskId !== state.taskId || ['succeeded','failed','cancelled'].includes(state.status)) scheduleSave();
}
function watchCanvasDepthCapture(node){
    const capture = node?.depthCapture;
    if(!capture || ['succeeded','failed','cancelled'].includes(capture.status)) return;
    const operationId = capture.operationId;
    CanvasDepthCapture.watch(`canvas:${canvas?.id}:${operationId}`,
        async () => {
            const live = nodes.find(n => n.id === node.id && n.depthCapture?.operationId === operationId);
            if(!live) throw new Error('结果节点已移除');
            return live.depthCapture.taskId
                ? CanvasDepthCapture.get(live.depthCapture.taskId)
                : CanvasDepthCapture.submit(live.depthCapture.sourceUrl, operationId);
        }, task => updateCanvasDepthCapture(nodes.filter(n => n.depthCapture?.operationId === operationId), task, operationId));
}
async function startCanvasDepthCapture(sourceId, sourceUrl){
    const source = nodes.find(n => n.id === sourceId);
    if(!source) throw new Error('原视频节点已不存在');
    pushUndo();
    const id = CanvasDepthCapture.operationId();
    const rect = nodeRect(source);
    const base = {sourceId, sourceUrl, operationId:id, taskId:'', status:'submitting',
        stage:'保存画布并提交任务', error:'', createdAt:Date.now()};
    const sourceWidth = rect.w || rect.width || 260;
    const depth = {id:uid('img'), type:'image', x:rect.x + sourceWidth + 70, y:rect.y,
        url:'', name:'灰度深度参考', mediaKind:'video', depthCapture:{...base, role:'depth'}};
    const pose = {id:uid('img'), type:'image', x:rect.x + sourceWidth + 70, y:rect.y + 245,
        url:'', name:'骨骼姿态参考', mediaKind:'video', depthCapture:{...base, role:'pose'}};
    const group = {
        id:uid('grp'), type:'group',
        x:depth.x - 24, y:depth.y - 58,
        w:308, h:(pose.y - depth.y) + 336 + 90,
        items:[depth.id, pose.id]
    };
    nodes.push(depth, pose, group);
    connections.push({from:sourceId, to:depth.id}, {from:sourceId, to:pose.id});
    selected.clear();
    selected.add(group.id);
    render();
    if(!await saveCanvas()){
        updateCanvasDepthCapture([depth,pose], {status:'failed', stage:'画布保存失败', error:'请保存画布后重试'}, id);
        return;
    }
    watchCanvasDepthCapture(depth);
    CanvasDepthCapture.update();
}
async function retryCanvasDepthCapture(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node?.depthCapture) return;
    const pair = canvasDepthPair(node);
    const id = CanvasDepthCapture.operationId();
    pair.forEach(item => { item.url = ''; item.depthCapture = {...item.depthCapture,
        operationId:id, taskId:'', status:'submitting', stage:'保存画布并重试', error:'',
        result_url:'', pose_url:'', pose_data_url:'', createdAt:Date.now()}; });
    render();
    if(!await saveCanvas()){
        updateCanvasDepthCapture(pair, {status:'failed', stage:'画布保存失败', error:'请保存画布后重试'}, id);
        return;
    }
    watchCanvasDepthCapture(pair[0]);
}
async function cancelCanvasDepthCapture(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node?.depthCapture?.taskId) return;
    const task = await CanvasDepthCapture.cancel(node.depthCapture.taskId);
    updateCanvasDepthCapture(canvasDepthPair(node), task, node.depthCapture.operationId);
}
function resumeCanvasDepthCaptureTasks(){
    nodes.filter(node => node.depthCapture && !['succeeded','failed','cancelled'].includes(node.depthCapture.status))
        .forEach(watchCanvasDepthCapture);
}
function openOutputNodeMenu(nodeId, clientX, clientY){
    return CanvasNodeMenu.openOutputNodeMenu(classicMenuHost(), nodeId, clientX, clientY);
}
function closeImageNodeMenu(){
    return CanvasNodeMenu.closeImageNodeMenu(classicMenuHost());
}
function outputImageUrls(node){
    return (node?.images || []).filter(item => mediaKindForOutputItem(item) === 'image').map(outputUrlValue).filter(Boolean);
}
function outputDownloadableImageUrls(node){
    return (node?.images || []).map(outputUrlValue).filter(url => url && !isMissingAssetUrl(url) && (url.startsWith('/output/') || url.startsWith('/assets/')));
}
function groupImageItems(group){
    if(!group || group.type !== 'group') return [];
    return (group.items || [])
        .map(id => nodes.find(n => n.id === id))
        .filter(n => n?.type === 'image' && n.url && mediaKindForNode(n) === 'image' && !isMissingAssetUrl(n.url))
        .map((n, index) => ({url:n.url, name:n.name || outputImageName(n.url) || `image-${index + 1}.png`, kind:'image', nodeId:n.id, __index:index}));
}
function extensionFromNameOrUrl(name='', url=''){
    const source = [name, url].map(value => String(value || '').split('?')[0].split('#')[0]).find(value => /\.[a-z0-9]{2,8}$/i.test(value));
    return source?.match(/(\.[a-z0-9]{2,8})$/i)?.[1] || '.png';
}
function safeDownloadFileName(name, fallback='image.png'){
    const cleaned = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim() || fallback;
    return cleaned;
}
function downloadNameForGroupImage(item, index=0){
    const fallback = `image-${String(index + 1).padStart(2, '0')}${extensionFromNameOrUrl(item?.name, item?.url)}`;
    let name = safeDownloadFileName(item?.name || outputImageName(item?.url || '') || fallback, fallback);
    if(!/\.[a-z0-9]{2,8}$/i.test(name)) name += extensionFromNameOrUrl(name, item?.url);
    return name;
}
function classicOutputCoordinationHost(){
    return {
        get connections(){return connections;},
        set connections(value){connections=value;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selected(){return selected;},
        addGenerationLog:(...args)=>addGenerationLog(...args),
        appendOutputImages:(...args)=>appendOutputImages(...args),
        canConnect:(...args)=>canConnect(...args),
        fetch:(...args)=>fetch(...args),
        findOutputByPendingId:(...args)=>findOutputByPendingId(...args),
        mergeGeneratedOutputs:(...args)=>mergeGeneratedOutputs(...args),
        nowMs:(...args)=>nowMs(...args),
        outputImageName:(...args)=>outputImageName(...args),
        outputImageUrls:(...args)=>outputImageUrls(...args),
        pendingById:(...args)=>pendingById(...args),
        pollCanvasComfyTask:(...args)=>pollCanvasComfyTask(...args),
        pollCanvasImageTask:(...args)=>pollCanvasImageTask(...args),
        pollCanvasRunningHubTask:(...args)=>pollCanvasRunningHubTask(...args),
        pollCanvasVideoTask:(...args)=>pollCanvasVideoTask(...args),
        pushUndo:(...args)=>pushUndo(...args),
        refreshGeneratorInputViews:(...args)=>refreshGeneratorInputViews(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        refreshRunNodes:(...args)=>refreshRunNodes(...args),
        render:(...args)=>render(...args),
        requestMetaFromResult:(...args)=>requestMetaFromResult(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setStatus:(...args)=>setStatus(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        syncGeneratorInputs:(...args)=>syncGeneratorInputs(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function createInputGroupFromOutput(node, point){
    return CanvasOutputEdit.createInputGroupFromOutput(classicOutputCoordinationHost(), node, point);
}
function convertOutputNodeToInputGroup(nodeId){
    return CanvasOutputEdit.convertOutputNodeToInputGroup(classicOutputCoordinationHost(), nodeId);
}
function copyOutputNodeToInputGroup(nodeId){
    return CanvasOutputEdit.copyOutputNodeToInputGroup(classicOutputCoordinationHost(), nodeId);
}
async function downloadOutputNodeImages(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    const urls = outputDownloadableImageUrls(node);
    if(!node || !urls.length){
        alert(tr('canvas.outputDownloadEmpty'));
        return;
    }
    try {
        const res = await fetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                urls,
                filename:`${(canvas?.title || 'canvas-output').slice(0, 48)}-${node.id}.zip`
            })
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.outputDownloadEmpty')));
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${(canvas?.title || 'canvas-output').slice(0, 48)}-${node.id}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch(err) {
        alert(err.message || tr('canvas.outputDownloadEmpty'));
    }
}
async function downloadGroupNodeImages(groupId){
    const group = nodes.find(n => n.id === groupId);
    const items = groupImageItems(group);
    if(!group || !items.length){
        alert(tr('canvas.outputDownloadEmpty'));
        return;
    }
    const filename = safeDownloadFileName(`${canvas?.title || 'canvas-group'}-${group.id}.zip`, 'canvas-group.zip');
    try {
        const res = await fetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                filename,
                urls:items.map(item => item.url).filter(Boolean),
                items:items.map((item, index) => ({url:item.url, name:downloadNameForGroupImage(item, index)}))
            })
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.outputDownloadEmpty')));
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1200);
    } catch(err) {
        alert(err.message || tr('canvas.outputDownloadEmpty'));
    }
}
function createLinkedNode(type){
    return CanvasNodeEdit.createLinkedNode(classicNodeEditHost(), type);
}
function createNodeByType(type, point){
    return CanvasNodeEdit.createNodeByType(classicNodeEditHost(), type, point);
}
function menuAdd(type){
    return CanvasNodeEdit.menuAdd(classicNodeEditHost(), type);
}
function classicUploadHost(){
    return {
        captureMediaInputContext:()=>classicMediaInputController.capture(),
        get document(){return document;},
        fillImageNode:(...args)=>fillImageNode(...args),
        get CANVAS_UPLOAD_MAX(){return CANVAS_UPLOAD_MAX;},
        get CANVAS_UPLOAD_MAX_BATCH_BYTES(){return CANVAS_UPLOAD_MAX_BATCH_BYTES;},
        get CANVAS_UPLOAD_MAX_FILE_BYTES(){return CANVAS_UPLOAD_MAX_FILE_BYTES;},
        get DOMParser(){return DOMParser;},
        get IMAGE_DROP_EXT_RE(){return IMAGE_DROP_EXT_RE;},
        get IMAGE_DROP_TEXT_TYPES(){return IMAGE_DROP_TEXT_TYPES;},
        get URL(){return URL;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get dropOverlay(){return dropOverlay;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selected(){return selected;},
        get window(){return window;},
        canConnect:(...args)=>canConnect(...args),
        defaultPoint:(...args)=>defaultPoint(...args),
        ensureCanvas:(...args)=>ensureCanvas(...args),
        fetch:(...args)=>fetch(...args),
        hasImageDropData:(...args)=>hasImageDropData(...args),
        hasImageFiles:(...args)=>hasImageFiles(...args),
        hasOutputImageDrag:(...args)=>hasOutputImageDrag(...args),
        isAudioUrl:(...args)=>isAudioUrl(...args),
        isVideoUrl:(...args)=>isVideoUrl(...args),
        langIsEn:(...args)=>langIsEn(...args),
        mediaKindForUpload:(...args)=>mediaKindForUpload(...args),
        nodeBounds:(...args)=>nodeBounds(...args),
        outputImageName:(...args)=>outputImageName(...args),
        pickMediaForNode:(...args)=>pickMediaForNode(...args),
        pushUndo:(...args)=>pushUndo(...args),
        render:(...args)=>render(...args),
        resolveImageDropPayload:(...args)=>resolveImageDropPayload(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        setStatus:(...args)=>setStatus(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        uid:(...args)=>uid(...args)
    };
}
function mediaKindForUpload(file){
    return CanvasMediaDrop.mediaKindForUpload(classicUploadHost(), file);
}
function isSupportedUploadFile(file){
    return CanvasMediaDrop.isSupportedUploadFile(classicUploadHost(), file);
}
function dataTransferItemEntry(item){
    return CanvasMediaDrop.dataTransferItemEntry(classicUploadHost(), item);
}
async function filesFromEntry(entry){
    return CanvasMediaDrop.filesFromEntry(classicUploadHost(), entry);
}
async function uploadFilesFromDataTransfer(dataTransfer){
    return CanvasMediaDrop.uploadFilesFromDataTransfer(classicUploadHost(), dataTransfer);
}
function isAudioUrl(url){
    return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(canvasOriginalMediaUrl(url));
}
function isTextUrl(url){
    return /\.(txt|json|csv|srt|vtt|md)(\?|$)/i.test(canvasOriginalMediaUrl(url));
}
function mediaKindForRef(ref){
    const kind = String(ref?.kind || ref?.mediaKind || '').toLowerCase();
    if(['video','audio','image','text','file'].includes(kind)) return kind;
    const url = String(ref?.url || ref || '');
    if(isVideoUrl(url)) return 'video';
    if(isAudioUrl(url)) return 'audio';
    if(isTextUrl(url)) return 'text';
    return 'image';
}
function imageRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForRef(ref) === 'image').slice(0, CANVAS_REFERENCE_IMAGE_MAX);
}
function videoRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForRef(ref) === 'video');
}
function isRemoteVideoReferenceUrl(url){
    return /^https?:\/\//i.test(String(url || '')) || /^asset:\/\//i.test(String(url || ''));
}
function tempShUploadedUrlForNode(node, url){
    const match = (node?.tempShLinks || []).find(item => item?.source === url && item?.url);
    return match?.url || url;
}
function applyUploadedUrlToRefs(refs, node){
    return (refs || []).map(ref => {
        if(!ref?.url) return ref;
        const url = tempShUploadedUrlForNode(node, ref.url);
        return url && url !== ref.url ? {...ref, url, originalLocalUrl:ref.originalLocalUrl || ref.url} : ref;
    });
}
function manualVideoUrlForNode(node){
    return (node?.manualVideoUrls || []).find(Boolean) || '';
}
function currentCanvasMediaLinks(node){
    const refs = orderedSources(node, generatorSources(node)).flatMap(src => src.refs || [])
        .filter(ref => ref?.url && ['image','video'].includes(mediaKindForRef(ref)));
    return refs.map(ref => {
        const uploaded = tempShUploadedUrlForNode(node, ref.url);
        return uploaded && uploaded !== ref.url ? uploaded : '';
    }).filter(Boolean);
}
function clearManualVideoUrlForNode(node){
    if(!node) return;
    node.manualVideoUrls = [];
    node.tempShLinks = (node.tempShLinks || []).filter(item => item?.manual !== true);
}
function applyTempShUrlToCanvasRef(ref, uploadedUrl){
    if(!ref?.url || !uploadedUrl) return false;
    const source = nodes.find(n => n.id === ref.nodeId);
    if(!source) return false;
    const kind = mediaKindForRef(ref);
    if(source.type === 'image' && source.url === ref.url){
        source.originalLocalUrl = source.originalLocalUrl || source.url;
        source.url = uploadedUrl;
        source.mediaKind = kind;
        return true;
    }
    if(source.type === 'output' && Array.isArray(source.images)){
        const item = Number.isFinite(Number(ref.outputIndex))
            ? source.images[Number(ref.outputIndex)]
            : source.images.find(img => outputUrlValue(img) === ref.url);
        if(item && typeof item === 'object'){
            item.originalLocalUrl = item.originalLocalUrl || outputUrlValue(item);
            item.url = uploadedUrl;
            item.kind = kind;
            return true;
        }
    }
    if(Array.isArray(source.generatedOutputs)){
        const item = source.generatedOutputs.find(img => outputUrlValue(img) === ref.url);
        if(item && typeof item === 'object'){
            item.originalLocalUrl = item.originalLocalUrl || outputUrlValue(item);
            item.url = uploadedUrl;
            item.kind = kind;
            return true;
        }
    }
    return false;
}
async function uploadCanvasMediaRefToCloud(node, ref){
    const kind = mediaKindForRef(ref);
    if(!ref?.url) throw new Error('没有可上传的媒体');
    if(/^https?:\/\//i.test(ref.url)) return ref.url;
    const response = await fetch('/api/cloud-video/upload', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:ref.url, service:'auto'})
    });
    if(!response.ok) throw new Error(await responseErrorMessage(response, '云端上传失败'));
    const data = await response.json();
    const uploadedUrl = data.url || '';
    if(!uploadedUrl) throw new Error('云端没有返回链接');
    node.tempShLinks = [
        ...(node.tempShLinks || []).filter(item => item?.source !== ref.url),
        {source:ref.url, url:uploadedUrl, expires:data.expires || '3 days', kind}
    ];
    applyTempShUrlToCanvasRef(ref, uploadedUrl);
    return uploadedUrl;
}
async function uploadCanvasVideosToCloud(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return [];
    const refs = orderedSources(node, generatorSources(node)).flatMap(src => src.refs || [])
        .filter(ref => ref?.url && ['image','video'].includes(mediaKindForRef(ref)));
    const localRefs = refs.filter(ref => ref?.url && !isRemoteVideoReferenceUrl(ref.url));
    if(!localRefs.length){
        showErrorModal('没有需要上传的本地图片或视频', '上传云端');
        return [];
    }
    node.tempShUploading = true;
    refreshNodes([node.id]);
    try {
        const urls = [];
        for(const ref of localRefs){
            urls.push(await uploadCanvasMediaRefToCloud(node, ref));
        }
        node.tempShUploading = false;
        refreshNodes([node.id, ...localRefs.map(ref => ref.nodeId).filter(Boolean)]);
        scheduleSave();
        await copyTextToClipboard(urls[0]);
        showErrorModal(`已上传 ${urls.length} 个媒体文件到云端，首个链接已复制。链接约 3 天有效。`, '上传云端');
        return urls;
    } catch(e) {
        node.tempShUploading = false;
        refreshNodes([node.id]);
        throw e;
    }
}
function applyManualVideoUrlToCanvasRef(node, ref, manualUrl){
    clearManualVideoUrlForNode(node);
    node.manualVideoUrls = [manualUrl];
    if(ref?.url) node.tempShLinks = [...(node.tempShLinks || []), {source:ref.url, url:manualUrl, manual:true}];
}
async function setCanvasManualVideoUrl(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return '';
    const refs = orderedSources(node, generatorSources(node)).flatMap(src => src.refs || [])
        .filter(ref => ref?.url && ['image','video'].includes(mediaKindForRef(ref)));
    const firstLocal = refs.find(ref => ref?.url && !isRemoteVideoReferenceUrl(ref.url));
    const firstAny = firstLocal || refs[0] || null;
    const current = manualVideoUrlForNode(node) || currentCanvasMediaLinks(node)[0] || (firstAny ? tempShUploadedUrlForNode(node, firstAny.url) : '');
    const value = prompt('输入媒体网址 / 火山素材 URI', isRemoteVideoReferenceUrl(current) ? current : '');
    if(value === null) return '';
    const url = String(value || '').trim();
    if(!url){
        clearManualVideoUrlForNode(node);
        refreshNodes([node.id]);
        scheduleSave();
        showErrorModal('已清除手动网址。', '输入网址');
        return '';
    }
    if(!isRemoteVideoReferenceUrl(url)){
        showErrorModal('请输入 http/https 媒体网址或 asset:// 火山素材 URI', '输入网址');
        return '';
    }
    applyManualVideoUrlToCanvasRef(node, firstAny, url);
    refreshNodes([node.id, firstAny?.nodeId].filter(Boolean));
    scheduleSave();
    showErrorModal('已设置视频网址。', '输入网址');
    return url;
}
function audioRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForRef(ref) === 'audio');
}
function mediaKindForNode(node){
    if(node?.type==='audio')return 'audio';
    if(node?.mediaKind) return node.mediaKind;
    if(isVideoUrl(node?.url)) return 'video';
    if(isAudioUrl(node?.url)) return 'audio';
    return 'image';
}
function nodeTitleForMedia(node){
    const kind = mediaKindForNode(node);
    if(kind === 'video') return 'Video';
    if(kind === 'audio') return 'Audio';
    return 'Image';
}
const IMAGE_DROP_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const IMAGE_DROP_TEXT_TYPES = [
    'text/uri-list',
    'text/plain',
    'text/html',
    'DownloadURL',
    'text/x-moz-url',
    'text/x-file-url',
    'public.file-url',
    'public.url',
    'UniformResourceLocator',
    'FileName',
    'FileNameW'
];
const IMAGE_DROP_TYPE_HINT_RE = /^(?:files?|image\/.+|text\/(?:uri-list|html|plain|x-moz-url|x-file-url)|downloadurl|public\.(?:file-url|url)|uniformresourcelocator|filenamew?)$|application\/x-qt-(?:windows-mime|image)|application\/x-moz-file|com\.eagle/i;
function dropDataTypes(dataTransfer){
    return CanvasMediaDrop.dropDataTypes(classicUploadHost(), dataTransfer);
}
function readDropData(dataTransfer, type){
    return CanvasMediaDrop.readDropData(classicUploadHost(), dataTransfer, type);
}
function decodeDropText(value){
    return CanvasMediaDrop.decodeDropText(classicUploadHost(), value);
}
function imageDropTextFragments(value){
    return CanvasMediaDrop.imageDropTextFragments(classicUploadHost(), value);
}
function uniqueValues(values){
    return CanvasMediaDrop.uniqueValues(classicUploadHost(), values);
}
function dropTextCandidates(dataTransfer){
    return CanvasMediaDrop.dropTextCandidates(classicUploadHost(), dataTransfer);
}
function isRemoteImageDropValue(value){
    return CanvasMediaDrop.isRemoteImageDropValue(classicUploadHost(), value);
}
function isLocalImageDropValue(value){
    return CanvasMediaDrop.isLocalImageDropValue(classicUploadHost(), value);
}
function imageFilesFromDataTransfer(dataTransfer){
    return CanvasMediaDrop.imageFilesFromDataTransfer(classicUploadHost(), dataTransfer);
}
function localImagePathsFromDataTransfer(dataTransfer){
    return CanvasMediaDrop.localImagePathsFromDataTransfer(classicUploadHost(), dataTransfer);
}
function imageUrlFromDataTransfer(dataTransfer){
    return CanvasMediaDrop.imageUrlFromDataTransfer(classicUploadHost(), dataTransfer);
}
function imageDropPayload(dataTransfer){
    return CanvasMediaDrop.imageDropPayload(classicUploadHost(), dataTransfer);
}
async function resolveImageDropPayload(dataTransfer){
    return CanvasMediaDrop.resolveImageDropPayload(classicUploadHost(), dataTransfer);
}
async function importLocalImages(paths){
    return CanvasUploadCoordination.importLocalImages(classicUploadHost(), paths);
}
function layoutUploadedMediaNodes(created, base){
    return CanvasUploadCoordination.layoutUploadedMediaNodes(classicUploadHost(), created, base);
}
function createGroupForUploadedNodes(created, point){
    return CanvasUploadCoordination.createGroupForUploadedNodes(classicUploadHost(), created, point);
}
async function uploadMediaFiles(files, point, onlyImages=false, opts={}){
    return CanvasUploadCoordination.uploadMediaFiles(classicUploadHost(), files, point, onlyImages, opts);
}
async function uploadImages(files, point){
    return CanvasUploadCoordination.uploadImages(classicUploadHost(), files, point);
}
async function uploadImageGroup(files, point){
    return CanvasUploadCoordination.uploadImageGroup(classicUploadHost(), files, point);
}
function createImageCardFromUrl(url, point, name='image', kind=''){
    return CanvasUploadCoordination.createImageCardFromUrl(classicUploadHost(), url, point, name, kind);
}
async function createImageCardsFromLocalPaths(paths, point){
    return CanvasUploadCoordination.createImageCardsFromLocalPaths(classicUploadHost(), paths, point);
}
async function applyImageDropPayloadToBoard(payload, point){
    return CanvasUploadCoordination.applyImageDropPayloadToBoard(classicUploadHost(), payload, point);
}
async function applyImageDropPayloadToNode(nodeId, payload){
    return CanvasUploadCoordination.applyImageDropPayloadToNode(classicUploadHost(), nodeId, payload);
}
function allowImageNodeDropEvent(e, highlightEl){
    return CanvasUploadCoordination.allowImageNodeDropEvent(classicUploadHost(), e, highlightEl);
}
function clearImageNodeDropState(e, highlightEl){
    return CanvasUploadCoordination.clearImageNodeDropState(classicUploadHost(), e, highlightEl);
}
async function handleImageNodeDropEvent(e, nodeId, highlightEl){
    return CanvasUploadCoordination.handleImageNodeDropEvent(classicUploadHost(), e, nodeId, highlightEl);
}
async function fillImageNode(nodeId, files, opts={}){
    return CanvasUploadCoordination.fillImageNode(classicUploadHost(), nodeId, files, opts);
}
function setImageNodeFromOutput(nodeId, url){
    return CanvasUploadCoordination.setImageNodeFromOutput(classicUploadHost(), nodeId, url);
}
function clearImageNode(nodeId, event=null){
    return CanvasUploadCoordination.clearImageNode(classicUploadHost(), nodeId, event);
}
function pickImageForNode(nodeId){
    return CanvasUploadCoordination.pickImageForNode(classicUploadHost(), nodeId);
}
function classicImageEditorHost(){
    return {
        captureImageEditContext:options=>ImageEditorSession.capture(classicImageEditorHost(),options),
        captureCanvasContext:()=>{const canvasCurrent=classicMediaInputController.capture(),editorCurrent=classicImageEditorEvents.capture();return ()=>canvasCurrent()&&editorCurrent();},
        get editImageSource(){return nodes.find(n=>n.id===cropState?.nodeId)?.url||'';},
        get editSourceKey(){return nodes.find(n=>n.id===cropState?.nodeId)?.url||'';},
        get FormData(){return FormData;},
        fetch:(...args)=>fetch(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        get cropAspectPreset(){return cropAspectPreset;},
        set cropAspectPreset(value){cropAspectPreset=value;},
        get cropAspectRatio(){return cropAspectRatio;},
        set cropAspectRatio(value){cropAspectRatio=value;},
        get cropDrag(){return cropDrag;},
        set cropDrag(value){cropDrag=value;},
        get cropState(){return cropState;},
        set cropState(value){cropState=value;},
        get document(){return document;},
        get editDrawState(){return editDrawState;},
        set editDrawState(value){editDrawState=value;},
        get editTextDirty(){return editTextDirty;},
        set editTextDirty(value){editTextDirty=value;},
        get editTextDrag(){return editTextDrag;},
        set editTextDrag(value){editTextDrag=value;},
        get editTextItems(){return editTextItems;},
        set editTextItems(value){editTextItems=value;},
        get editTextSelectedId(){return editTextSelectedId;},
        set editTextSelectedId(value){editTextSelectedId=value;},
        get gridCustomDrag(){return gridCustomDrag;},
        set gridCustomDrag(value){gridCustomDrag=value;},
        get gridCustomHistory(){return gridCustomHistory;},
        set gridCustomHistory(value){gridCustomHistory=value;},
        get gridCustomLines(){return gridCustomLines;},
        set gridCustomLines(value){gridCustomLines=value;},
        get gridCustomMode(){return gridCustomMode;},
        set gridCustomMode(value){gridCustomMode=value;},
        get gridCustomOrientation(){return gridCustomOrientation;},
        set gridCustomOrientation(value){gridCustomOrientation=value;},
        get imageEditBaseH(){return imageEditBaseH;},
        set imageEditBaseH(value){imageEditBaseH=value;},
        get imageEditBaseW(){return imageEditBaseW;},
        set imageEditBaseW(value){imageEditBaseW=value;},
        get imageEditMode(){return imageEditMode;},
        set imageEditMode(value){imageEditMode=value;},
        get imageEditModeTouched(){return imageEditModeTouched;},
        set imageEditModeTouched(value){imageEditModeTouched=value;},
        get imageEditZoom(){return imageEditZoom;},
        set imageEditZoom(value){imageEditZoom=value;},
        get imageResizeScale(){return imageResizeScale;},
        set imageResizeScale(value){imageResizeScale=value;},
        get nodes(){return nodes;},
        _syncGridCustomCursor:(...args)=>_syncGridCustomCursor(...args),
        _syncGridCustomUndoBtn:(...args)=>_syncGridCustomUndoBtn(...args),
        _updateZoomLabel:(...args)=>_updateZoomLabel(...args),
        alert:(...args)=>alert(...args),
        applyImageBrush:(...args)=>applyImageBrush(...args),
        applyImageGridSplit:(...args)=>applyImageGridSplit(...args),
        applyImageMask:(...args)=>applyImageMask(...args),
        canvasDisplayMediaUrl:(...args)=>canvasDisplayMediaUrl(...args),
        canvasMediaPreviewUrl:(...args)=>canvasMediaPreviewUrl(...args),
        clearEditDrawing:(...args)=>clearEditDrawing(...args),
        editDrawCanvas:(...args)=>editDrawCanvas(...args),
        editTextCanvas:(...args)=>editTextCanvas(...args),
        exceedsFourKStandard:(...args)=>exceedsFourKStandard(...args),
        installCanvasViewAdjustMenu:(...args)=>installCanvasViewAdjustMenu(...args),
        mediaKindForNode:(...args)=>mediaKindForNode(...args),
        refreshGridSplitPreview:(...args)=>refreshGridSplitPreview(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        removeEditTextInlineEditor:(...args)=>removeEditTextInlineEditor(...args),
        render:(...args)=>render(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        resetEditDrawingHistory:(...args)=>resetEditDrawingHistory(...args),
        resizeEditDrawCanvas:(...args)=>resizeEditDrawCanvas(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setTimeout:(...args)=>setTimeout(...args),
        syncBrushToolButtons:(...args)=>syncBrushToolButtons(...args),
        syncEditDrawingHistoryButtons:(...args)=>syncEditDrawingHistoryButtons(...args),
        syncGridGapValue:(...args)=>syncGridGapValue(...args),
        syncTextToolState:(...args)=>syncTextToolState(...args),
        tr:(...args)=>tr(...args),
        uploadCroppedBlob:(...args)=>uploadCroppedBlob(...args)
    };
}
function cropBounds(){
    return CanvasImageEditor.cropBounds(classicImageEditorHost());
}
function editDrawCanvas(){
    return CanvasEditorDraw.editDrawCanvas(classicEditorDrawHost());
}
function classicEditorDrawHost(){
    return {
        captureImageEditContext:options=>ImageEditorSession.capture(classicImageEditorHost(),options),
        get EDIT_DRAW_HISTORY_MAX(){return EDIT_DRAW_HISTORY_MAX;},
        get MASK_BRUSH_ALPHA(){return MASK_BRUSH_ALPHA;},
        get MASK_BRUSH_COLOR(){return MASK_BRUSH_COLOR;},
        get brushLabelCounter(){return brushLabelCounter;},
        set brushLabelCounter(value){brushLabelCounter=value;},
        get brushTool(){return brushTool;},
        set brushTool(value){brushTool=value;},
        get cropState(){return cropState;},
        get document(){return document;},
        get editDrawRedoStack(){return editDrawRedoStack;},
        set editDrawRedoStack(value){editDrawRedoStack=value;},
        get editDrawState(){return editDrawState;},
        set editDrawState(value){editDrawState=value;},
        get editDrawUndoStack(){return editDrawUndoStack;},
        set editDrawUndoStack(value){editDrawUndoStack=value;},
        get editTextDirty(){return editTextDirty;},
        set editTextDirty(value){editTextDirty=value;},
        get editTextDrag(){return editTextDrag;},
        set editTextDrag(value){editTextDrag=value;},
        get editTextInlineEditor(){return editTextInlineEditor;},
        set editTextInlineEditor(value){editTextInlineEditor=value;},
        get editTextItems(){return editTextItems;},
        set editTextItems(value){editTextItems=value;},
        get editTextSelectedId(){return editTextSelectedId;},
        set editTextSelectedId(value){editTextSelectedId=value;},
        get gridCustomDrag(){return gridCustomDrag;},
        set gridCustomDrag(value){gridCustomDrag=value;},
        get gridCustomHistory(){return gridCustomHistory;},
        get gridCustomLines(){return gridCustomLines;},
        get gridCustomMode(){return gridCustomMode;},
        get gridCustomOrientation(){return gridCustomOrientation;},
        get imageEditMode(){return imageEditMode;},
        get nodes(){return nodes;},
        get window(){return window;},
        _syncGridCustomUndoBtn:(...args)=>_syncGridCustomUndoBtn(...args),
        addGeneratedImageNode:(...args)=>addGeneratedImageNode(...args),
        brushColor:(...args)=>brushColor(...args),
        closeImageEditor:(...args)=>closeImageEditor(...args),
        editBrushSize:(...args)=>editBrushSize(...args),
        editDrawPoint:(...args)=>editDrawPoint(...args),
        editTextCanvas:(...args)=>editTextCanvas(...args),
        editTextHasContent:(...args)=>editTextHasContent(...args),
        gridCustomLineHit:(...args)=>gridCustomLineHit(...args),
        langIsEn:(...args)=>langIsEn(...args),
        pushEditDrawHistory:(...args)=>pushEditDrawHistory(...args),
        refreshGridSplitPreview:(...args)=>refreshGridSplitPreview(...args),
        removeEditTextInlineEditor:(...args)=>removeEditTextInlineEditor(...args),
        render:(...args)=>render(...args),
        renderEditTextCanvas:(...args)=>renderEditTextCanvas(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        resizeEditTextCanvas:(...args)=>resizeEditTextCanvas(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setGridCustomLinePos:(...args)=>setGridCustomLinePos(...args),
        syncTextToolState:(...args)=>syncTextToolState(...args),
        uid:(...args)=>uid(...args),
        uploadCroppedBlob:(...args)=>uploadCroppedBlob(...args)
    };
}
function editTextCanvas(){
    return CanvasEditorText.editTextCanvas(classicEditorDrawHost());
}
function editTextContext(){
    return CanvasEditorText.editTextContext(classicEditorDrawHost());
}
function selectedEditTextItem(){
    return CanvasEditorText.selectedEditTextItem(classicEditorDrawHost());
}
function defaultEditTextText(){
    return CanvasEditorText.defaultEditTextText(classicEditorDrawHost());
}
function editTextSizeFromBrush(){
    return CanvasEditorText.editTextSizeFromBrush(classicEditorDrawHost());
}
function createEditTextItem(text, point, preset={}){
    return CanvasEditorText.createEditTextItem(classicEditorDrawHost(), text, point, preset);
}
function textItemFont(item){
    return CanvasEditorText.textItemFont(classicEditorDrawHost(), item);
}
function measureEditTextItem(item, ctx=editTextContext()){
    return CanvasEditorText.measureEditTextItem(classicEditorDrawHost(), item, ctx);
}
function hitEditTextItem(point){
    return CanvasEditorText.hitEditTextItem(classicEditorDrawHost(), point);
}
function renderEditTextCanvas(){
    return CanvasEditorText.renderEditTextCanvas(classicEditorDrawHost());
}
function syncTextToolState(force=false){
    return CanvasEditorText.syncTextToolState(classicEditorDrawHost(), force);
}
function syncSelectedEditTextStyleFromBrush(){
    return CanvasEditorText.syncSelectedEditTextStyleFromBrush(classicEditorDrawHost());
}
function beginTextEditChange(){
    return CanvasEditorText.beginTextEditChange(classicEditorDrawHost());
}
function setSelectedEditTextItem(id){
    return CanvasEditorText.setSelectedEditTextItem(classicEditorDrawHost(), id);
}
function confirmSelectedEditTextItem(){
    return CanvasEditorText.confirmSelectedEditTextItem(classicEditorDrawHost());
}
function editTextCanvasScale(){
    return CanvasEditorText.editTextCanvasScale(classicEditorDrawHost());
}
function selectInlineEditorText(el){
    return CanvasEditorText.selectInlineEditorText(classicEditorDrawHost(), el);
}
function inlineEditorText(){
    return CanvasEditorText.inlineEditorText(classicEditorDrawHost());
}
function autosizeEditTextInlineEditor(){
    return CanvasEditorText.autosizeEditTextInlineEditor(classicEditorDrawHost());
}
function positionEditTextInlineEditor(){
    return CanvasEditorText.positionEditTextInlineEditor(classicEditorDrawHost());
}
function removeEditTextInlineEditor(commit=true){
    return CanvasEditorText.removeEditTextInlineEditor(classicEditorDrawHost(), commit);
}
function beginEditTextInline(item){
    return CanvasEditorText.beginEditTextInline(classicEditorDrawHost(), item);
}
function editTextPoint(event){
    return CanvasEditorText.editTextPoint(classicEditorDrawHost(), event);
}
function beginEditText(event){
    return CanvasEditorText.beginEditText(classicEditorDrawHost(), event);
}
function updateEditTextCursor(event){
    return CanvasEditorText.updateEditTextCursor(classicEditorDrawHost(), event);
}
function moveEditText(event){
    return CanvasEditorText.moveEditText(classicEditorDrawHost(), event);
}
function endEditText(event){
    return CanvasEditorText.endEditText(classicEditorDrawHost(), event);
}
function editTextHasContent(){
    return CanvasEditorText.editTextHasContent(classicEditorDrawHost());
}
function resizeEditTextCanvas(){
    return CanvasEditorText.resizeEditTextCanvas(classicEditorDrawHost());
}
function resizeEditDrawCanvas(){
    return CanvasEditorDraw.resizeEditDrawCanvas(classicEditorDrawHost());
}
function setImageEditMode(mode, userTouched=false){
    return CanvasImageEditor.setImageEditMode(classicImageEditorHost(), mode, userTouched);
}
function editDrawSnapshot(){
    return CanvasEditorDraw.editDrawSnapshot(classicEditorDrawHost());
}
function restoreEditDrawSnapshot(snapshot){
    return CanvasEditorDraw.restoreEditDrawSnapshot(classicEditorDrawHost(), snapshot);
}
function pushEditDrawHistory(){
    return CanvasEditorDraw.pushEditDrawHistory(classicEditorDrawHost());
}
function syncEditDrawingHistoryButtons(){
    return CanvasEditorDraw.syncEditDrawingHistoryButtons(classicEditorDrawHost());
}
function undoEditDrawing(){
    return CanvasEditorDraw.undoEditDrawing(classicEditorDrawHost());
}
function redoEditDrawing(){
    return CanvasEditorDraw.redoEditDrawing(classicEditorDrawHost());
}
function clearEditDrawing(silent=false){
    return CanvasEditorDraw.clearEditDrawing(classicEditorDrawHost(), silent);
}
function resetEditDrawingHistory(){
    return CanvasEditorDraw.resetEditDrawingHistory(classicEditorDrawHost());
}
function setBrushTool(tool){
    return CanvasEditorDraw.setBrushTool(classicEditorDrawHost(), tool);
}
function syncBrushToolButtons(){
    return CanvasEditorDraw.syncBrushToolButtons(classicEditorDrawHost());
}
function editDrawPoint(event){
    return CanvasEditorDraw.editDrawPoint(classicEditorDrawHost(), event);
}
function classicEditorGridHost(){
    return {
        captureImageEditContext:options=>ImageEditorSession.capture(classicImageEditorHost(),options),
        get cropState(){return cropState;},
        get document(){return document;},
        get gridCustomDrag(){return gridCustomDrag;},
        set gridCustomDrag(value){gridCustomDrag=value;},
        get gridCustomHistory(){return gridCustomHistory;},
        set gridCustomHistory(value){gridCustomHistory=value;},
        get gridCustomLines(){return gridCustomLines;},
        set gridCustomLines(value){gridCustomLines=value;},
        get gridCustomMode(){return gridCustomMode;},
        set gridCustomMode(value){gridCustomMode=value;},
        get gridCustomOrientation(){return gridCustomOrientation;},
        set gridCustomOrientation(value){gridCustomOrientation=value;},
        get imageEditMode(){return imageEditMode;},
        get nodes(){return nodes;},
        appendOutputImages:(...args)=>appendOutputImages(...args),
        closeImageEditor:(...args)=>closeImageEditor(...args),
        editDrawCanvas:(...args)=>editDrawCanvas(...args),
        imageEditorOutputNode:(...args)=>imageEditorOutputNode(...args),
        render:(...args)=>render(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args),
        uploadImageBlobs:(...args)=>uploadImageBlobs(...args)
    };
}
function gridCustomLineHit(point){
    return CanvasEditorGrid.gridCustomLineHit(classicEditorGridHost(), point);
}
function setGridCustomLinePos(index, point){
    return CanvasEditorGrid.setGridCustomLinePos(classicEditorGridHost(), index, point);
}
function editBrushSize(){
    return CanvasEditorDraw.editBrushSize(classicEditorDrawHost());
}
function brushColor(){
    return CanvasEditorDraw.brushColor(classicEditorDrawHost());
}
const MASK_BRUSH_ALPHA = 115;
const MASK_BRUSH_COLOR = `rgba(255,255,255,${MASK_BRUSH_ALPHA / 255})`;
function setupDrawStyle(ctx){
    return CanvasEditorDraw.setupDrawStyle(classicEditorDrawHost(), ctx);
}
function normalizeMaskPreviewCanvas(canvasEl=editDrawCanvas()){
    return CanvasEditorDraw.normalizeMaskPreviewCanvas(classicEditorDrawHost(), canvasEl);
}
function circledNumber(n){
    return CanvasEditorDraw.circledNumber(classicEditorDrawHost(), n);
}
function drawBrushShape(ctx, start, end, preview=false){
    return CanvasEditorDraw.drawBrushShape(classicEditorDrawHost(), ctx, start, end, preview);
}
function drawNumberLabel(point){
    return CanvasEditorDraw.drawNumberLabel(classicEditorDrawHost(), point);
}
function beginEditDraw(event){
    return CanvasEditorDraw.beginEditDraw(classicEditorDrawHost(), event);
}
function moveEditDraw(event){
    return CanvasEditorDraw.moveEditDraw(classicEditorDrawHost(), event);
}
function endEditDraw(event){
    return CanvasEditorDraw.endEditDraw(classicEditorDrawHost(), event);
}
function editCanvasHasPixels(){
    return CanvasEditorDraw.editCanvasHasPixels(classicEditorDrawHost());
}
function syncGridGapValue(){
    return CanvasEditorGrid.syncGridGapValue(classicEditorGridHost());
}
function gridSplitSettings(){
    return CanvasEditorGrid.gridSplitSettings(classicEditorGridHost());
}
function gridSplitRects(width, height){
    return CanvasEditorGrid.gridSplitRects(classicEditorGridHost(), width, height);
}
function gridSplitRectsCustom(width, height){
    return CanvasEditorGrid.gridSplitRectsCustom(classicEditorGridHost(), width, height);
}
function gridLayoutFromRects(rects){
    return CanvasEditorGrid.gridLayoutFromRects(classicEditorGridHost(), rects);
}
function applyGridPreset(rows, cols){
    return CanvasEditorGrid.applyGridPreset(classicEditorGridHost(), rows, cols);
}
// ——— 自定义宫格辅助函数 ———
function toggleGridCustomMode(){
    return CanvasEditorGrid.toggleGridCustomMode(classicEditorGridHost());
}
function setGridCustomOrientation(orient){
    return CanvasEditorGrid.setGridCustomOrientation(classicEditorGridHost(), orient);
}
function clearGridCustomLines(){
    return CanvasEditorGrid.clearGridCustomLines(classicEditorGridHost());
}
function undoGridCustomLine(){
    return CanvasEditorGrid.undoGridCustomLine(classicEditorGridHost());
}
function _syncGridCustomUndoBtn(){
    return CanvasEditorGrid._syncGridCustomUndoBtn(classicEditorGridHost());
}
function clampImageResizeScale(value){
    return CanvasImageEditor.clampImageResizeScale(classicImageEditorHost(), value);
}
function imageResizeDimensions(){
    return CanvasImageEditor.imageResizeDimensions(classicImageEditorHost());
}
function syncImageResizeControls(){
    return CanvasImageEditor.syncImageResizeControls(classicImageEditorHost());
}
function setImageResizeScale(value){
    return CanvasImageEditor.setImageResizeScale(classicImageEditorHost(), value);
}
async function resizedImageBlobFromEditor(){
    return CanvasImageEditor.resizedImageBlobFromEditor(classicImageEditorHost());
}
// ——— 图片缩放 ———
function applyImageEditZoom(){
    return CanvasImageEditor.applyImageEditZoom(classicImageEditorHost());
}
function syncImageEditOverflow(){
    return CanvasImageEditor.syncImageEditOverflow(classicImageEditorHost());
}
function resetImageEditZoom(){
    return CanvasImageEditor.resetImageEditZoom(classicImageEditorHost());
}
function _updateZoomLabel(){
    const el = document.getElementById('imageEditZoomLabel');
    if(el) el.textContent = Math.round(imageEditZoom * 100) + '%';
}
function _syncGridCustomCursor(){
    return CanvasEditorGrid._syncGridCustomCursor(classicEditorGridHost());
}
function refreshGridSplitPreview(){
    return CanvasEditorGrid.refreshGridSplitPreview(classicEditorGridHost());
}
function imageEditorOutputPoint(node, offsetY=0){
    return {x:(node.x || 0) + Number(node.w || 260) + 36, y:(node.y || 0) + offsetY};
}
function imageEditorOutputNode(sourceNode){
    let out = connections.filter(c => c.from === sourceNode.id)
        .map(c => nodes.find(n => n.id === c.to))
        .find(n => n?.type === 'output');
    if(!out){
        const p = imageEditorOutputPoint(sourceNode, 0);
        out = {id:uid('out'), type:'output', x:p.x, y:p.y, images:[]};
        nodes.push(out);
    }
    return out;
}
function addGeneratedImageNode(file, sourceNode, suffix, offsetY=0, extra={}){
    const p = imageEditorOutputPoint(sourceNode, offsetY);
    const next = {id:uid('img'), type:'image', x:p.x, y:p.y, url:file.url, name:file.name || suffix, ...extra};
    nodes.push(next);
    selected.clear();
    selected.add(next.id);
    return next;
}
function renderCropBox(){
    return CanvasImageEditor.renderCropBox(classicImageEditorHost());
}
function outpaintNaturalSize(){
    return CanvasImageEditor.outpaintNaturalSize(classicImageEditorHost());
}
function updateOutpaintResolutionLabel(){
    return CanvasImageEditor.updateOutpaintResolutionLabel(classicImageEditorHost());
}
function clampOutpaint(){
    return CanvasImageEditor.clampOutpaint(classicImageEditorHost());
}
function resetOutpaintBox(){
    return CanvasImageEditor.resetOutpaintBox(classicImageEditorHost());
}
function cropRatioFromPreset(preset){
    return CanvasImageEditor.cropRatioFromPreset(classicImageEditorHost(), preset);
}
function syncCropRatioButtons(){
    return CanvasImageEditor.syncCropRatioButtons(classicImageEditorHost());
}
function fitCropRectToAspect(ratio, sourceRect=null){
    return CanvasImageEditor.fitCropRectToAspect(classicImageEditorHost(), ratio, sourceRect);
}
function setCropAspectPreset(preset='free'){
    return CanvasImageEditor.setCropAspectPreset(classicImageEditorHost(), preset);
}
function resetCropBox(){
    return CanvasImageEditor.resetCropBox(classicImageEditorHost());
}
function openImageEditor(nodeId, initialMode='crop'){
    return CanvasImageEditor.openImageEditor(classicImageEditorHost(), nodeId, initialMode);
}
function closeImageEditor(){
    return CanvasImageEditor.closeImageEditor(classicImageEditorHost());
}
function installCanvasViewAdjustMenu(){
    const host = document.querySelector('#imageEditModal .image-edit-mode');
    if(!host || host.querySelector('.view-adjust-menu')) return;
    host.insertAdjacentHTML('beforeend', CanvasViewAdjust.menuHtml());
    host.querySelectorAll('[data-view-adjust]').forEach(button => button.addEventListener('click', event => {
        event.stopPropagation();
        button.closest('details').open = false;
        openCanvasViewAdjustment(cropState?.nodeId, button.dataset.viewAdjust);
    }));
}
function createCanvasViewAdjustApiNode(source, compiled){
    if(!source?.url) throw new Error('原图片已删除或改变，请重新打开');
    const providerId=compiled.selection?.providerId || imageApiProviders()[0]?.id || '', model=compiled.selection?.model || allImageModels(providerId)[0] || '';
    const x=Number(source.x || 0)+460, y=Number(source.y || 0);
    const occupied=nodes.map(nodeRect);
    pushUndo();
    const target = {
        id:uid('gen'), type:'generator', x, y,
        apiProvider:providerId, model,
        count:1, ratio:'source', resolution:defaultApiImageResolution(model),
        quality:'auto', inputs:[], viewAdjustPrompt:compiled.prompt,
        viewAdjust:{kind:compiled.kind, sourceNodeId:source.id, params:compiled.params, title:compiled.title}
    };
    nodes.push(target);
    connections.push({id:uid('c'), from:source.id, to:target.id});
    selected = new Set([target.id]);
    render();
    // Measure the native API card, whose height depends on its prompt and controls.
    const box=nodeRect(target);
    for(let hit;(hit=occupied.find(rect=>x<rect.x+rect.w && x+box.w>rect.x && target.y<rect.y+rect.h && target.y+box.h>rect.y));)target.y=hit.y+hit.h+28;
    if(target.y!==y)render();
    scheduleSave();
    return target;
}
function openCanvasViewAdjustment(nodeId, kind){
    const source = nodes.find(node => node.id === nodeId);
    if(!source?.url || mediaKindForNode(source) !== 'image') return;
    const sourceUrl = source.url, owner = canvas?.id;
    const isAlive = () => canvas?.id === owner && nodes.some(node => node.id === nodeId && node.url === sourceUrl);
    CanvasViewAdjust.open({kind,source:{url:sourceUrl,previewUrl:canvasDisplayMediaUrl(sourceUrl,source.name || '')},
        models:CanvasViewAdjust.configuredModels(imageApiProviders(),provider=>allImageModels(provider.id)),initial:source.viewAdjustDrafts?.[kind],isAlive,
        onDraft:draft => {if(!isAlive())return;const live=nodes.find(node=>node.id===nodeId);live.viewAdjustDrafts={...live.viewAdjustDrafts,[kind]:draft};scheduleSave();},
        onSubmit:async compiled => {
            if(!isAlive())throw new Error('原图片已改变，请重新打开');
            if(compiled.selection && (!imageApiProviders().some(provider=>provider.id===compiled.selection.providerId) || !allImageModels(compiled.selection.providerId).includes(compiled.selection.model)))throw new Error('API 模型配置已改变，请重新打开调整面板。');
            const live=nodes.find(node=>node.id===nodeId);
            const target=createCanvasViewAdjustApiNode(live,compiled);
            closeImageEditor();
            const box=nodeRect(target), view=board.getBoundingClientRect();
            viewport.scale=Math.max(0.06,Math.min(Math.max(safeViewportScale(viewport.scale),0.65),1,Math.max(1,view.width-96)/box.w,Math.max(1,view.height-120)/box.h));
            centerViewportOnWorldPoint({x:box.x+box.w/2,y:box.y+box.h/2});
            scheduleViewportSave();
            const saved=await saveCanvas();
            return {saved,message:saved?'API 节点已创建并保存，提示词和原图已关联；在节点上点击运行即可。':'API 节点已创建，但画布尚未保存。请先重试保存，无需再次创建节点。',nodeId:target.id};
        }
    });
}
function clampCrop(){
    return CanvasImageEditor.clampCrop(classicImageEditorHost());
}
function beginCropDrag(event, mode){
    return CanvasImageEditor.beginCropDrag(classicImageEditorHost(), event, mode);
}
function resizeOutpaintFromDrag(dx, dy){
    return CanvasImageEditor.resizeOutpaintFromDrag(classicImageEditorHost(), dx, dy);
}
function clampAspectCropToBounds(anchorX, anchorY, movingX, movingY, ratio, handle){
    return CanvasImageEditor.clampAspectCropToBounds(classicImageEditorHost(), anchorX, anchorY, movingX, movingY, ratio, handle);
}
function resizeCropFromDrag(dx, dy){
    return CanvasImageEditor.resizeCropFromDrag(classicImageEditorHost(), dx, dy);
}
async function uploadCroppedBlob(blob, name, isCurrent){
    return CanvasImageEditor.uploadCroppedBlob(classicImageEditorHost(), blob, name, isCurrent);
}
async function uploadImageBlobs(blobs, isCurrent){
    return CanvasImageEditor.uploadImageBlobs(classicImageEditorHost(), blobs, isCurrent);
}
async function applyImageCrop(){
    return CanvasImageEditor.applyImageCrop(classicImageEditorHost());
}
async function applyImageOutpaint(){
    return CanvasImageEditor.applyImageOutpaint(classicImageEditorHost());
}
async function applyImageMask(){
    return CanvasEditorDraw.applyImageMask(classicEditorDrawHost());
}
function maskCanvasFromDrawCanvas(src){
    return CanvasEditorDraw.maskCanvasFromDrawCanvas(classicEditorDrawHost(), src);
}
async function applyImageBrush(){
    return CanvasEditorDraw.applyImageBrush(classicEditorDrawHost());
}
async function applyImageGridSplit(){
    return CanvasEditorGrid.applyImageGridSplit(classicEditorGridHost());
}
async function applyImageResize(){
    return CanvasImageEditor.applyImageResize(classicImageEditorHost());
}
function applyImageEdit(){
    return CanvasImageEditor.applyImageEdit(classicImageEditorHost());
}

function nodeHasLiveMedia(node){
    return node?.type === 'image' && node.url && ['video','audio'].includes(mediaKindForNode(node));
}
function captureMediaPlaybackState(media){
    if(!media) return null;
    return {
        currentTime:Number.isFinite(media.currentTime) ? media.currentTime : 0,
        paused:Boolean(media.paused),
        playbackRate:Number.isFinite(media.playbackRate) ? media.playbackRate : 1,
        muted:Boolean(media.muted),
        volume:Number.isFinite(media.volume) ? media.volume : 1
    };
}
function restoreMediaPlaybackState(media, state){
    if(!media || !state) return;
    try { media.playbackRate = state.playbackRate || 1; } catch(e) {}
    try { media.muted = state.muted; } catch(e) {}
    try { media.volume = state.volume; } catch(e) {}
    const applyTime = () => {
        if(Number.isFinite(state.currentTime) && state.currentTime > 0 && Math.abs((media.currentTime || 0) - state.currentTime) > 0.2){
            try { media.currentTime = state.currentTime; } catch(e) {}
        }
        if(!state.paused && typeof media.play === 'function'){
            const promise = media.play();
            if(promise?.catch) promise.catch(() => {});
        }
    };
    if(media.readyState >= 1) applyTime();
    else media.addEventListener('loadedmetadata', applyTime, {once:true});
}
function mediaSignatureFromElement(el){
    const media = el?.querySelector?.('video,audio');
    if(!media) return '';
    const tag = media.tagName.toLowerCase();
    const url = media.dataset?.url || media.getAttribute('src') || '';
    return url ? `${tag}:${url}` : '';
}
function transplantNodeMediaElement(oldNodeEl, newNodeEl){
    const oldMedia = oldNodeEl?.querySelector?.('video,audio');
    if(!oldMedia) return;
    const newMedia = newNodeEl?.querySelector?.('video,audio');
    const newVideoPreview = oldMedia.tagName.toLowerCase() === 'video'
        ? newNodeEl?.querySelector?.('img[data-preview-kind="video"]') : null;
    const replacement = newMedia || newVideoPreview;
    if(!replacement) return;
    const oldSignature = mediaSignatureFromElement(oldNodeEl);
    const newSignature = newMedia ? mediaSignatureFromElement(newNodeEl)
        : `video:${newVideoPreview.dataset.originalSrc || newVideoPreview.dataset.url || ''}`;
    if(!oldSignature || oldSignature !== newSignature) return;
    const state = captureMediaPlaybackState(oldMedia);
    replacement.replaceWith(oldMedia);
    if(newVideoPreview) newNodeEl.querySelector('.canvas-video-play')?.style?.setProperty('display', 'none');
    restoreMediaPlaybackState(oldMedia, state);
    requestAnimationFrame(() => restoreMediaPlaybackState(oldMedia, state));
}
function transplantInputPreviews(oldNodeEl, newNodeEl){
    if(!oldNodeEl || !newNodeEl) return;
    const oldItems = [...oldNodeEl.querySelectorAll('.input-list .input-item')];
    newNodeEl.querySelectorAll('.input-list .input-item').forEach((item, index) => {
        const oldItem = oldItems[index];
        if(!oldItem || oldItem.dataset.sourceId !== item.dataset.sourceId) return;
        const oldPreview = oldItem.querySelector('img[data-original-src], video[data-url]');
        const newPreview = item.querySelector('img[data-original-src], video[data-url]');
        const oldUrl = oldPreview?.dataset.originalSrc || oldPreview?.dataset.url;
        const newUrl = newPreview?.dataset.originalSrc || newPreview?.dataset.url;
        if(oldUrl && oldUrl === newUrl) newPreview.replaceWith(oldPreview);
    });

}
function captureMediaPlaybackStates(){
    const states = new Map();
    nodesEl.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const tag = media.tagName.toLowerCase();
        const url = media.dataset.url || media.getAttribute('src') || '';
        if(url) states.set(`${tag}:${url}`, captureMediaPlaybackState(media));
    });
    return states;
}
function restoreMediaPlaybackStates(states){
    if(!states?.size) return;
    nodesEl.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const tag = media.tagName.toLowerCase();
        const url = media.dataset.url || media.getAttribute('src') || '';
        restoreMediaPlaybackState(media, states.get(`${tag}:${url}`));
    });
}
function measureCanvasOriginalImageNodes(root=nodesEl){
    root.querySelectorAll?.('.image-node img[data-original-src]').forEach(imgEl => {
        if(imgEl.dataset.previewKind === 'video') return;
        const nodeEl = imgEl.closest('.image-node');
        const node = nodes.find(n => n.id === nodeEl?.dataset.id);
        if(!node || node.type !== 'image' || !node.url || node.natural_w || node.natural_h || node._naturalSizeLoading) return;
        const original = imgEl.dataset.originalSrc || node.url;
        if(!original) return;
        node._naturalSizeLoading = true;
        loadCanvasOriginalImageDimensions(original).then(size => {
            node._naturalSizeLoading = false;
            if(!size || node.natural_w || node.natural_h) return;
            node.natural_w = size.w;
            node.natural_h = size.h;
            scheduleSave();
        });
    });
}

function canvasClipMediaItems(canvasNodes, libraryItems=[], localItems=[]){
    const current = (canvasNodes || []).flatMap(node => window.CanvasClipHost?.mediaForNode?.(node, canvasNodes) || []);
    const all = [...current, ...(libraryItems || []), ...(localItems || [])];
    const unique = new Map();
    for(const item of all){
        const url = item?.url || item?.renderUrl;
        if(!url) continue;
        const kind = item.kind || mediaKindForOutputItem(item);
        if(!['image','video'].includes(kind)) continue;
        if(unique.has(url)) continue;
        unique.set(url, {
            ...item,
            kind, url,
            name: item.name || outputImageName(url),
            posterUrl: item.posterUrl || item.thumbnail || item.poster || '',
            durationSeconds: item.durationSeconds || item.duration,
            sourceResultId: item.sourceResultId || item.id || url,
        });
    }
    return [...unique.values()];
}
function initCanvasVideoDeconstructionBridge(){
    if(!window.CanvasVideoDeconstructionHost || window.CanvasVideoDeconstructionBridge) return;
    let generation=0;
    const sourceFor=(nodeId,url,title)=>{
        const n=nodes.find(n=>n.id===nodeId);
        const item=window.CanvasClipHost.mediaForNode(n,nodes).find(x=>x.kind==='video'&&x.url===url);
        return item ? {canvasId:canvas?.id,nodeId,resultId:item.sourceResultId,sourceUrl:item.url,title:title||item.name} : null;
    };
    const bridge=window.CanvasVideoDeconstructionHost.create({
        getState:()=>({canvas,nodes,connections,generation,scale:viewport.scale}),
        uid,pushUndo,save:scheduleSave,render,
        readSource:source=>sourceFor(source.nodeId,source.sourceUrl)?.resultId===source.resultId?source:null,
        select:ids=>{selected.clear();ids.forEach(id=>selected.add(id));refreshSelectionVisuals();},
        defaultImageSettings:()=>{const s=canvasAssistantCreationSettings();return {...s,providerId:s.provider_id};},
        defaultVideoSettings:()=>canvasAssistantCreationSettings(),
        nodeWidth:n=>Math.max(nodeRect(n).w,n.w||defaultNodeSize(n.type).w||0),
        rowSpacing:700,
        videoMedia:n=>window.CanvasClipHost.mediaForNode(n,nodes),
        prepareShotMedia:async media=>{
            const resolved=[];
            for(const item of media){const durationSeconds=item.durationSeconds||await window.CanvasClipBridge.probeDuration(item.url);if(!(durationSeconds>0))throw new Error(`无法读取${item.name}的真实时长，请确认视频可以播放后重试`);resolved.push({...item,durationSeconds});}
            return resolved;
        },
        addShotCollection:({table,media,existing})=>{
            if(existing&&existing.type!=='clip')throw new Error('原剪辑节点已改变，请先核对');
            const collection=existing||{id:uid('clip'),type:'clip',x:Math.max(...nodes.map(n=>n.x+nodeRect(n).w))+96,y:table.y,w:760,h:196,clipData:window.CanvasClipModel.createData(),name:'分镜视频剪辑'};
            let data=collection.clipData;for(const item of media)data=window.CanvasClipModel.addMedia(data,item);collection.clipData=data;
            if(!existing)nodes.push(collection);return collection;
        },
        collectionNotice:'已按镜号加入剪辑时间线。重复整理保留剪辑修改；重新生成的结果作为新片段加入。请预览并调整节奏、对白和声音后导出。',
        validateVideoSettings:s=>videoApiProviders().some(p=>p.id===s.videoProvider&&p.enabled!==false&&(p.video_models||[]).includes(s.videoModel)),
        createVideoChain:({row,promptText,id,settings,x,y,uid:makeId,imageNodeId})=>{
            const video={id:makeId('vid'),type:'video',x,y,viewAdjustPrompt:promptText,name:`镜头 ${row.index} · 视频`,apiProvider:settings.videoProvider||'',model:settings.videoModel||'',duration:settings.videoDuration||5,aspectRatio:settings.videoAspect||'16:9',resolution:settings.videoResolution||'',enhancePrompt:!!settings.videoEnhancePrompt,enableUpsample:!!settings.videoEnableUpsample,watermark:!!settings.videoWatermark,cameraFixed:!!settings.videoCameraFixed,generateAudio:!!settings.videoGenerateAudio,multimodal:!!settings.videoMultimodal,useFrameRoles:!!settings.videoUseFrameRoles,inputs:[],tempShLinks:[],running:false,shotTableOrigin:{tableId:id,rowId:row.id,stage:'video',inlineOutput:true,imageNodeId,durationSeconds:row.durationSeconds,startSeconds:row.startSeconds,endSeconds:row.endSeconds}};
            return {nodes:[video],connections:[{id:makeId('c'),from:imageNodeId,to:video.id}],promptId:video.id,generatorId:video.id,outputId:video.id};
        },
        focus:ids=>CanvasViewport.fitAllNodesViewport(classicViewportHost(),ids),
        validateImageSettings:s=>imageApiProviders().some(p=>p.id===s.providerId&&p.enabled!==false&&(p.image_models||[]).includes(s.model)),
        runGenerators:async ids=>{
            const owner=canvas?.id,epoch=generation;
            // 原生级联执行有自己的任务、并发和恢复，不另起生图接口。
            for(const id of ids){if(canvas?.id!==owner||generation!==epoch)break;await runNodeCascade(id);}
        }
    });
    const begin=bridge.begin;bridge.begin=()=>{generation++;begin();};
    bridge.sourceFor=sourceFor;bridge.saveNow=saveCanvas;bridge.onError=e=>setStatus(e.message);bridge.onNotice=text=>setStatus(text);
    window.CanvasVideoDeconstructionBridge=bridge;
}
function initCanvasClipBridge(){
    if(!window.CanvasClipHost || window.CanvasClipBridge) return;
    let generation=0;
    const durations=new Map();
    const probeDuration=url=>{
        if(durations.has(url)) return durations.get(url);
        const work=new Promise(resolve=>{
            const video=document.createElement('video');
            let settled=false;
            const finish=value=>{
                if(settled)return;settled=true;clearTimeout(timer);
                video.onloadedmetadata=null;video.onerror=null;video.removeAttribute('src');video.load();resolve(value);
            };
            const timer=setTimeout(()=>finish(undefined),8000);
            video.preload='metadata';video.muted=true;
            video.onloadedmetadata=()=>finish(Number.isFinite(video.duration)&&video.duration>0?video.duration:undefined);
            video.onerror=()=>finish(undefined);video.src=url;
        });
        durations.set(url,work);return work;
    };
    const bridge=window.CanvasClipHost.create({
        getState:()=>({canvas,nodes,connections,generation,scale:viewport.scale}),
        uid,pushUndo,save:scheduleSave,render,probeDuration,
        onError:error=>setStatus(`剪辑素材同步失败：${error.message}`),
        select:id=>{selected.clear();selected.add(id);nodesEl.querySelectorAll('.node').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));},
        deleteNode:id=>deleteNode(id),refreshIcons,download:downloadUrl,
        listMedia:async()=>{
            const loaded=await loadCanvasAssetLibrary({renderPanel:false});
            if(!loaded)throw new Error('资产库加载失败，请重试');
            const libraryItems=canvasAssetLibraries().flatMap(lib=>(lib.categories||[]).flatMap(cat=>cat.items||[]));
            return canvasClipMediaItems(nodes, libraryItems, localCanvasAssetLibrary.items || []);
        },
        upload:async file=>{
            const kind=mediaKindForUpload(file);
            if(!['image','video'].includes(kind))throw new Error('剪辑节点只接收图片和视频');
            const form=new FormData();form.append('files',file,file.name);
            const response=await fetch('/api/local-assets/upload',{method:'POST',body:form});
            const result=await response.json().catch(()=>({}));
            if(!response.ok)throw new Error(result.detail||'素材上传失败');
            const item=result.files?.[0];if(!item?.url)throw new Error('上传未返回有效素材，请重试');
            return {kind,url:item.url,name:item.name||file.name,posterUrl:item.thumbnail||'',durationSeconds:item.durationSeconds||item.duration,sourceResultId:item.id||item.url};
        },
    });
    bridge.begin=()=>{generation++;window.CanvasClipNode?.reconcile(bridge.getContext(),[]);};
    bridge.probeDuration=probeDuration;
    window.CanvasClipBridge=bridge;
    document.addEventListener('pointerdown',event=>{
        if(!event.target.closest('.clip-node,.clip-panel'))window.CanvasClipNode?.closeAll();
    },true);
}
function render(){
    if(window.CanvasVideoDeconstructionBridge) window.CanvasVideoDeconstructionUI.reconcile(window.CanvasVideoDeconstructionBridge,nodes.filter(n=>n.type==='shot-table').map(n=>n.id));
    if(window.CanvasClipBridge){
        window.CanvasClipNode?.reconcile(window.CanvasClipBridge.getContext(),nodes.filter(n=>n.type==='clip').map(n=>n.id));
        window.CanvasClipBridge.syncConnected();
    }
    const outputScrolls = captureOutputScrolls();
    const mediaStates = captureMediaPlaybackStates();
    const oldNodeElements = new Map();
    nodesEl.querySelectorAll('.node').forEach(el => {
        oldNodeElements.set(el.dataset.id, el);
    });
    applyViewport();
    nodes.forEach(node => {
        // 单个节点渲染异常不能中断整个循环，否则它后面的节点（含新建节点，通常排在末尾）都不会被
        // 追加进 DOM，连带这些节点的连线也会因找不到 DOM 而画到 (0,0) 变成“消失”。
        try {
            const fresh = renderNode(node);
            const old = oldNodeElements.get(node.id);
            transplantInputPreviews(old, fresh);
            nodesEl.appendChild(fresh);
            if(old){
                if(nodeHasLiveMedia(node)) transplantNodeMediaElement(old, fresh);
                if(old !== fresh) old.remove();
            }
        } catch(err){
            console.error('[canvas] renderNode 失败，已跳过该节点：', node?.id, node?.type, err);
        }
    });
    oldNodeElements.forEach((old, id) => {
        if(!nodes.some(node => node.id === id)) old.remove();
    });
    restoreMediaPlaybackStates(mediaStates);
    restoreOutputScrolls(outputScrolls);
    refreshGeometry();
    refreshGeometryAfterLayout();
    refreshIcons();
    bindCanvasPreviewImageFallbacks(nodesEl);
    syncCanvasSelectedImageResolution(nodesEl);
    measureCanvasOriginalImageNodes(nodesEl);
    refreshOutputTimer();
}
function refreshNodes(ids=[]){
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if(!uniqueIds.length) return;
    window.CanvasClipBridge?.syncConnected();
    const outputScrolls = captureOutputScrolls();
    applyViewport();
    for(const id of uniqueIds){
        const node = nodes.find(n => n.id === id);
        if(!node) continue;
        if(node.type === 'output' && refreshOutputNodeContent(node)) continue;
        const current = nodesEl.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
        if(!current){
            render();
            return;
        }
        try {
            const fresh = renderNode(node);
            if(nodeHasLiveMedia(node)) transplantNodeMediaElement(current, fresh);
            transplantInputPreviews(current, fresh);
            current.replaceWith(fresh);
        } catch(err){
            console.error('[canvas] refreshNode 失败，已跳过该节点：', id, err);
        }
    }
    restoreOutputScrolls(outputScrolls);
    refreshGeometry();
    refreshGeometryAfterLayout();
    refreshIcons();
    bindCanvasPreviewImageFallbacks(nodesEl);
    syncCanvasSelectedImageResolution(nodesEl);
    measureCanvasOriginalImageNodes(nodesEl);
    refreshOutputTimer();
}
function refreshRunNodes(node, out=null){
    refreshNodes([node?.id, out?.id]);
}
function normalizedPendingPreviewSize(size){
    return ClassicNodeParams.normalizedPendingPreviewSize(classicNodeParamsHost(), size);
}
function pendingPreviewSizeFromSizeString(sizeStr){
    return ClassicNodeParams.pendingPreviewSizeFromSizeString(classicNodeParamsHost(), sizeStr);
}
function pendingPreviewSizeFromNode(node){
    if(!node) return null;
    const natural = normalizedPendingPreviewSize({w:node.natural_w || node.width, h:node.natural_h || node.height});
    if(natural) return natural;
    if(node.type === 'image'){
        const img = nodesEl?.querySelector?.(`.image-node[data-id="${CSS.escape(node.id)}"] img`);
        if(isCanvasPreviewImage(img)) return null;
        const domSize = normalizedPendingPreviewSize({w:img?.naturalWidth, h:img?.naturalHeight});
        if(domSize) return domSize;
    }
    if(node.type === 'output'){
        const item = [...(node.images || [])].reverse().find(outputUrlValue);
        const meta = item && typeof item === 'object' ? item : {};
        return normalizedPendingPreviewSize(meta);
    }
    return null;
}
function pendingPreviewSizeFromRefs(refs=[]){
    for(const ref of refs || []){
        const direct = normalizedPendingPreviewSize(ref);
        if(direct) return direct;
        const url = ref?.url;
        if(!url) continue;
        const node = nodes.find(n =>
            (n.type === 'image' && n.url === url) ||
            (n.type === 'output' && (n.images || []).some(item => outputUrlValue(item) === url))
        );
        const nodeSize = pendingPreviewSizeFromNode(node);
        if(nodeSize) return nodeSize;
        const media = nodesEl?.querySelector?.(`[data-url="${CSS.escape(url)}"], [data-output-url="${CSS.escape(url)}"] img, img[src="${CSS.escape(url)}"]`);
        if(isCanvasPreviewImage(media)) continue;
        const domSize = normalizedPendingPreviewSize({w:media?.naturalWidth || media?.videoWidth, h:media?.naturalHeight || media?.videoHeight});
        if(domSize) return domSize;
    }
    return null;
}
function pendingPreviewSizeForRun(node, options={}){
    const requestSize = normalizedPendingPreviewSize(options.requestSize) || pendingPreviewSizeFromSizeString(options.requestSize);
    if(requestSize) return requestSize;
    if(node?.type === 'comfy' && (node.mode || 'text') === 'text'){
        return normalizedPendingPreviewSize({w:Number(node.width || 1024), h:Number(node.height || 1024)});
    }

    return pendingPreviewSizeFromRefs(options.refs || []);
}
function classicOutputViewHost(){
    return {
        get CSS(){return CSS;},
        get canvas(){return canvas;},
        get currentOutputCompareUrl(){return currentOutputCompareUrl;},
        set currentOutputCompareUrl(value){currentOutputCompareUrl=value;},
        get currentOutputLightboxOutId(){return currentOutputLightboxOutId;},
        set currentOutputLightboxOutId(value){currentOutputLightboxOutId=value;},
        get currentOutputLightboxUrl(){return currentOutputLightboxUrl;},
        set currentOutputLightboxUrl(value){currentOutputLightboxUrl=value;},
        get currentOutputMeta(){return currentOutputMeta;},
        set currentOutputMeta(value){currentOutputMeta=value;},
        get document(){return document;},
        get nodes(){return nodes;},
        get nodesEl(){return nodesEl;},
        get outputCompareContainer(){return outputCompareContainer;},
        get outputCompareDrag(){return outputCompareDrag;},
        set outputCompareDrag(value){outputCompareDrag=value;},
        get outputCompareOriginal(){return outputCompareOriginal;},
        get outputCompareOriginalWrap(){return outputCompareOriginalWrap;},
        get outputCompareResult(){return outputCompareResult;},
        get outputCompareSlider(){return outputCompareSlider;},
        get outputCopyPromptBtn(){return outputCopyPromptBtn;},
        get outputDownloadAllBtn(){return outputDownloadAllBtn;},
        get outputDownloadBtn(){return outputDownloadBtn;},
        get outputLightbox(){return outputLightbox;},
        get outputLightboxImg(){return outputLightboxImg;},
        get outputLightboxVideo(){return outputLightboxVideo;},
        get outputPreview(){return outputPreview;},
        get outputPreviewPan(){return outputPreviewPan;},
        set outputPreviewPan(value){outputPreviewPan=value;},
        get outputPreviewPanDrag(){return outputPreviewPanDrag;},
        set outputPreviewPanDrag(value){outputPreviewPanDrag=value;},
        get outputPreviewZoom(){return outputPreviewZoom;},
        set outputPreviewZoom(value){outputPreviewZoom=value;},
        get outputPromptPanel(){return outputPromptPanel;},
        get outputPromptText(){return outputPromptText;},
        get outputRerunBtn(){return outputRerunBtn;},
        get outputResolution(){return outputResolution;},
        get window(){return window;},
        alert:(...args)=>alert(...args),
        bindCanvasPreviewImageFallbacks:(...args)=>bindCanvasPreviewImageFallbacks(...args),
        canvasActivateVideoPreview:(...args)=>canvasActivateVideoPreview(...args),
        canvasDisplayMediaUrl:(...args)=>canvasDisplayMediaUrl(...args),
        canvasPreviewImgHtml:(...args)=>canvasPreviewImgHtml(...args),
        canvasVideoPreviewHtml:(...args)=>canvasVideoPreviewHtml(...args),
        clearTimeout:(...args)=>clearTimeout(...args),
        copyTextToClipboard:(...args)=>copyTextToClipboard(...args),
        downloadGroupNodeImages:(...args)=>downloadGroupNodeImages(...args),
        downloadUrl:(...args)=>downloadUrl(...args),
        escapeAttr:(...args)=>escapeAttr(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        formatRunDuration:(...args)=>formatRunDuration(...args),
        groupImageItems:(...args)=>groupImageItems(...args),
        isMissingAssetUrl:(...args)=>isMissingAssetUrl(...args),
        mediaKindForNode:(...args)=>mediaKindForNode(...args),
        mediaKindForOutputItem:(...args)=>mediaKindForOutputItem(...args),
        missingAssetHtml:(...args)=>missingAssetHtml(...args),
        normalizedPendingPreviewSize:(...args)=>normalizedPendingPreviewSize(...args),
        nowMs:(...args)=>nowMs(...args),
        openCanvasVideoEditor:(...args)=>openCanvasVideoEditor(...args),
        openOutputLightbox:(...args)=>openOutputLightbox(...args),
        outputDownloadName:(...args)=>outputDownloadName(...args),
        outputImageName:(...args)=>outputImageName(...args),
        outputMetaFor:(...args)=>outputMetaFor(...args),
        outputUrlValue:(...args)=>outputUrlValue(...args),
        pendingById:(...args)=>pendingById(...args),
        queryRecoverPendingOutput:(...args)=>queryRecoverPendingOutput(...args),
        refreshCanvasImagePending:(...args)=>refreshCanvasImagePending(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        refreshOutputTimer:(...args)=>refreshOutputTimer(...args),
        render:(...args)=>render(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        rerunFromOutputMeta:(...args)=>rerunFromOutputMeta(...args),
        saveAndQueryCanvasPendingTask:(...args)=>saveAndQueryCanvasPendingTask(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setTimeout:(...args)=>setTimeout(...args),
        syncCanvasSelectedImageResolution:(...args)=>syncCanvasSelectedImageResolution(...args),
        tr:(...args)=>tr(...args)
    };
}
function pendingOutputStyle(pending){
    return CanvasOutputView.pendingOutputStyle(classicOutputViewHost(), pending);
}
function renderPendingOutput(pending){
    return CanvasOutputView.renderPendingOutput(classicOutputViewHost(), pending);
}
function captureOutputScrolls(){
    return CanvasOutputView.captureOutputScrolls(classicOutputViewHost());
}
function restoreOutputScrolls(state){
    return CanvasOutputView.restoreOutputScrolls(classicOutputViewHost(), state);
}
function isNodeControl(target){
    if(target.closest('.shot-table-summary') && !target.closest('button, input, select, textarea, a')) return false;
    return !!target.closest('textarea, input, select, option, button, audio, video, [contenteditable="true"], .shot-table-body, .video-deconstruction-modal, .clip-axis-scroll, .clip-node-hint, .clip-panel, .seg, .gen-btn, .comfy-run, .input-item, .blank-image, .mode-tabs, .ms-model-tabs, .llm-provider, .llm-output, .llm-chat-log, .llm-pane-resizer, .loop-preview, .pr-wrapper, .pr-toolbar, .pr-viewport, .pr-canvas, .pr-player-controls, .pr-prompt-area');
}

function isNodeDragSurface(target){
    return !isNodeControl(target) && !target.closest('.port, .resize-handle, .output-img-wrap');
}
function classicNodeViewHost(){
    return {
        get CANVAS_GENERATOR_TYPES(){return CANVAS_GENERATOR_TYPES;},
        get Event(){return Event;},
        get MS_GEN_MODELS(){return MS_GEN_MODELS;},
        get comfyWorkflows(){return comfyWorkflows;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get document(){return document;},
        get internalDrag(){return internalDrag;},
        set internalDrag(value){internalDrag=value;},
        get nodes(){return nodes;},
        get promptTemplateModal(){return promptTemplateModal;},
        get promptTemplateNodeId(){return promptTemplateNodeId;},
        get selected(){return selected;},
        get window(){return window;},
        allowImageNodeDropEvent:(...args)=>allowImageNodeDropEvent(...args),
        applyRhEntrySelection:(...args)=>applyRhEntrySelection(...args),
        audioAnalysisApiProviders:(...args)=>audioAnalysisApiProviders(...args),
        audioAnalysisModelOptions:(...args)=>audioAnalysisModelOptions(...args),
        audioAnalysisProviderOptions:(...args)=>audioAnalysisProviderOptions(...args),
        autoSizeLoopForPanels:(...args)=>autoSizeLoopForPanels(...args),
        autoSizeLoopNode:(...args)=>autoSizeLoopNode(...args),
        bindCanvasPreviewImageFallbacks:(...args)=>bindCanvasPreviewImageFallbacks(...args),
        bindCascadeButtons:(...args)=>bindCascadeButtons(...args),
        bindOutputWrap:(...args)=>bindOutputWrap(...args),
        bindScrollableText:(...args)=>bindScrollableText(...args),
        canConnect:(...args)=>canConnect(...args),
        cancelCanvasDepthCapture:(...args)=>cancelCanvasDepthCapture(...args),
        canvasActivateVideoPreview:(...args)=>canvasActivateVideoPreview(...args),
        canvasApiAudioMode:(...args)=>canvasApiAudioMode(...args),
        canvasAudioModelOptions:(...args)=>canvasAudioModelOptions(...args),
        canvasAudioProviderOptions:(...args)=>canvasAudioProviderOptions(...args),
        canvasInputListNeedsRender:(...args)=>canvasInputListNeedsRender(...args),
        canvasPreviewImgHtml:(...args)=>canvasPreviewImgHtml(...args),
        canvasVideoPreviewHtml:(...args)=>canvasVideoPreviewHtml(...args),
        cascadeBtnHtml:(...args)=>cascadeBtnHtml(...args),
        chatModelOptions:(...args)=>chatModelOptions(...args),
        chatProviderOptions:(...args)=>chatProviderOptions(...args),
        comfyFieldKind:(...args)=>comfyFieldKind(...args),
        comfyFields:(...args)=>comfyFields(...args),
        comfyParamValue:(...args)=>comfyParamValue(...args),
        comfyRandomActive:(...args)=>comfyRandomActive(...args),
        comfyRandomEnabled:(...args)=>comfyRandomEnabled(...args),
        computeCascadeOrder:(...args)=>computeCascadeOrder(...args),
        copyTextToClipboard:(...args)=>copyTextToClipboard(...args),
        currentComfyWorkflow:(...args)=>currentComfyWorkflow(...args),
        currentMsModelId:(...args)=>currentMsModelId(...args),
        defaultApiImageResolution:(...args)=>defaultApiImageResolution(...args),
        defaultNodeSize:(...args)=>defaultNodeSize(...args),
        ensureComfyWorkflow:(...args)=>ensureComfyWorkflow(...args),
        ensureRhNodeSelection:(...args)=>ensureRhNodeSelection(...args),
        escapeAttr:(...args)=>escapeAttr(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        findLoopCascadeTarget:(...args)=>findLoopCascadeTarget(...args),
        generatorSources:(...args)=>generatorSources(...args),
        getImageDimensions:(...args)=>getImageDimensions(...args),
        groupImageItems:(...args)=>groupImageItems(...args),
        handleImageNodeDropEvent:(...args)=>handleImageNodeDropEvent(...args),
        hasComfyWorkflow:(...args)=>hasComfyWorkflow(...args),
        imageApiProviders:(...args)=>imageApiProviders(...args),
        imageModelOptions:(...args)=>imageModelOptions(...args),
        imageRefsOnly:(...args)=>imageRefsOnly(...args),
        insertLoopToken:(...args)=>insertLoopToken(...args),
        isCascadeActive:(...args)=>isCascadeActive(...args),
        isCascadeStopping:(...args)=>isCascadeStopping(...args),
        isGptImageAutoSizeModel:(...args)=>isGptImageAutoSizeModel(...args),
        isMissingAssetUrl:(...args)=>isMissingAssetUrl(...args),
        isNodeControl:(...args)=>isNodeControl(...args),
        isNodeDragSurface:(...args)=>isNodeDragSurface(...args),
        langIsEn:(...args)=>langIsEn(...args),
        llmInputAudios:(...args)=>llmInputAudios(...args),
        llmInputImages:(...args)=>llmInputImages(...args),
        llmInputText:(...args)=>llmInputText(...args),
        llmInputVideos:(...args)=>llmInputVideos(...args),
        loopCount:(...args)=>loopCount(...args),
        loopEditorText:(...args)=>loopEditorText(...args),
        loopInputImageRefs:(...args)=>loopInputImageRefs(...args),
        loopInputPromptItems:(...args)=>loopInputPromptItems(...args),
        loopVariableHtml:(...args)=>loopVariableHtml(...args),
        mediaKindForNode:(...args)=>mediaKindForNode(...args),
        mediaKindForRef:(...args)=>mediaKindForRef(...args),
        midjourneyProviderOptions:(...args)=>midjourneyProviderOptions(...args),
        missingAssetHtml:(...args)=>missingAssetHtml(...args),
        modelscopeImageModelOptions:(...args)=>modelscopeImageModelOptions(...args),
        modelscopeImageModels:(...args)=>modelscopeImageModels(...args),
        modelscopeLoraOptions:(...args)=>modelscopeLoraOptions(...args),
        modelscopeLorasForModel:(...args)=>modelscopeLorasForModel(...args),
        nodeTitleForMedia:(...args)=>nodeTitleForMedia(...args),
        normalizeApiNodeLayout:(...args)=>normalizeApiNodeLayout(...args),
        normalizeApiNodeSizeChoice:(...args)=>normalizeApiNodeSizeChoice(...args),
        openGeneratorNodeMenu:(...args)=>openGeneratorNodeMenu(...args),
        openGroupLightbox:(...args)=>openGroupLightbox(...args),
        openImageEditor:(...args)=>openImageEditor(...args),
        openImageNodeMenu:(...args)=>openImageNodeMenu(...args),
        openImageNodePreview:(...args)=>openImageNodePreview(...args),
        openOutputNodeMenu:(...args)=>openOutputNodeMenu(...args),
        openPromptTemplateModal:(...args)=>openPromptTemplateModal(...args),
        orderedSources:(...args)=>orderedSources(...args),
        parseRunningHubEntryKey:(...args)=>parseRunningHubEntryKey(...args),
        parseSizeValue:(...args)=>parseSizeValue(...args),
        pickImageForNode:(...args)=>pickImageForNode(...args),
        promptCounterHtml:(...args)=>promptCounterHtml(...args),
        providerAudioAnalysisModels:(...args)=>providerAudioAnalysisModels(...args),
        providerChatModels:(...args)=>providerChatModels(...args),
        providerImageModels:(...args)=>providerImageModels(...args),
        providerOptions:(...args)=>providerOptions(...args),
        providerVideoModels:(...args)=>providerVideoModels(...args),
        ratioPartsFromDimensions:(...args)=>ratioPartsFromDimensions(...args),
        refreshGeneratorInputViews:(...args)=>refreshGeneratorInputViews(...args),
        refreshGeometry:(...args)=>refreshGeometry(...args),
        refreshGeometryAfterLayout:(...args)=>refreshGeometryAfterLayout(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        refreshPromptCounter:(...args)=>refreshPromptCounter(...args),
        refreshSelectionVisuals:(...args)=>refreshSelectionVisuals(...args),
        render:(...args)=>render(...args),
        renderCanvasApiAudio:(...args)=>renderCanvasApiAudio(...args),
        renderCanvasAudioMaterial:(...args)=>renderCanvasAudioMaterial(...args),
        renderComfyBody:(...args)=>renderComfyBody(...args),
        renderGeneratorBody:(...args)=>renderGeneratorBody(...args),
        renderImageInputList:(...args)=>renderImageInputList(...args),
        renderLLMBody:(...args)=>renderLLMBody(...args),
        renderLoopBody:(...args)=>renderLoopBody(...args),
        renderLoopPrompt:(...args)=>renderLoopPrompt(...args),
        renderMidjourneyBody:(...args)=>renderMidjourneyBody(...args),
        renderMsGenBody:(...args)=>renderMsGenBody(...args),
        renderOutputGrid:(...args)=>renderOutputGrid(...args),
        renderPendingOutput:(...args)=>renderPendingOutput(...args),
        renderPromptPreview:(...args)=>renderPromptPreview(...args),
        renderRhBody:(...args)=>renderRhBody(...args),
        renderVideoBody:(...args)=>renderVideoBody(...args),
        renderVideoImageInputs:(...args)=>renderVideoImageInputs(...args),
        reorderInput:(...args)=>reorderInput(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        requestCascadeStop:(...args)=>requestCascadeStop(...args),
        resolveChatModel:(...args)=>resolveChatModel(...args),
        resolveChatProviderId:(...args)=>resolveChatProviderId(...args),
        resolveImageModel:(...args)=>resolveImageModel(...args),
        resolveMidjourneyProviderId:(...args)=>resolveMidjourneyProviderId(...args),
        retryBarHtml:(...args)=>retryBarHtml(...args),
        retryCanvasDepthCapture:(...args)=>retryCanvasDepthCapture(...args),
        rhActiveFields:(...args)=>rhActiveFields(...args),
        rhCurrentKind:(...args)=>rhCurrentKind(...args),
        rhEntryOptions:(...args)=>rhEntryOptions(...args),
        rhExtractFieldOptions:(...args)=>rhExtractFieldOptions(...args),
        rhFieldRole:(...args)=>rhFieldRole(...args),
        rhFieldValue:(...args)=>rhFieldValue(...args),
        rhMediaSources:(...args)=>rhMediaSources(...args),
        rhParamKey:(...args)=>rhParamKey(...args),
        rhPaymentOptions:(...args)=>rhPaymentOptions(...args),
        rhRandomActive:(...args)=>rhRandomActive(...args),
        rhRandomEnabled:(...args)=>rhRandomEnabled(...args),
        rhSelectedEntryRef:(...args)=>rhSelectedEntryRef(...args),
        runCanvasGenerate:(...args)=>runCanvasGenerate(...args),
        runLLMChat:(...args)=>runLLMChat(...args),
        runLLMNode:(...args)=>runLLMNode(...args),
        runMidjourneyAction:(...args)=>runMidjourneyAction(...args),
        runMidjourneyModal:(...args)=>runMidjourneyModal(...args),
        runNodeCascade:(...args)=>runNodeCascade(...args),
        runningHubAllEntries:(...args)=>runningHubAllEntries(...args),
        runningHubEntryKey:(...args)=>runningHubEntryKey(...args),
        sanitizeImageNodeProviderModel:(...args)=>sanitizeImageNodeProviderModel(...args),
        sanitizeVideoNodeProviderModel:(...args)=>sanitizeVideoNodeProviderModel(...args),
        scheduleGeneratorInputSync:(...args)=>scheduleGeneratorInputSync(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setCanvasGeneratorSizeFields:(...args)=>setCanvasGeneratorSizeFields(...args),
        setCanvasManualVideoUrl:(...args)=>setCanvasManualVideoUrl(...args),
        setCanvasMsSizeFields:(...args)=>setCanvasMsSizeFields(...args),
        setCanvasWorkflowParameters:(...args)=>setCanvasWorkflowParameters(...args),
        setTimeout:(...args)=>setTimeout(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        startLLMPaneResize:(...args)=>startLLMPaneResize(...args),
        startLink:(...args)=>startLink(...args),
        startNodeDrag:(...args)=>startNodeDrag(...args),
        startNodeResize:(...args)=>startNodeResize(...args),
        syncGeneratorInputs:(...args)=>syncGeneratorInputs(...args),
        toggleComfyRandom:(...args)=>toggleComfyRandom(...args),
        toggleRhRandom:(...args)=>toggleRhRandom(...args),
        tr:(...args)=>tr(...args),
        trf:(...args)=>trf(...args),
        uploadCanvasVideosToCloud:(...args)=>uploadCanvasVideosToCloud(...args),
        validComfyWorkflowName:(...args)=>validComfyWorkflowName(...args),
        videoModelOptions:(...args)=>videoModelOptions(...args),
        videoProviderOptions:(...args)=>videoProviderOptions(...args)
    };
}
function renderNode(node){
    return CanvasNodeView.renderNode(classicNodeViewHost(), node);
}
function bindOutputWrap(wrap, node){
    return CanvasOutputView.bindOutputWrap(classicOutputViewHost(), wrap, node);
}
function outputDomKeyForItem(item){
    return CanvasOutputView.outputDomKeyForItem(classicOutputViewHost(), item);
}
function outputDomKeyForPending(pending){
    return CanvasOutputView.outputDomKeyForPending(classicOutputViewHost(), pending);
}
function refreshOutputNodeContent(node){
    return CanvasOutputView.refreshOutputNodeContent(classicOutputViewHost(), node);
}
function defaultNodeSize(type){
    return ClassicNodeParams.defaultNodeSize(classicNodeParamsHost(), type);
}
function loopCount(node){
    return Math.max(1, Math.min(100, Number(node?.count || 1) || 1));
}
function splitPromptIntoItems(text){
    const trimmed = String(text || '').trim();
    if(!trimmed) return [];
    const numbered = trimmed.split(/\s*(?:^|\s)\d+\s*[.、)）．]\s+/).map(s => s.trim()).filter(Boolean);
    if(numbered.length >= 2) return numbered;
    const lines = trimmed.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
    if(lines.length >= 2) return lines;
    return [trimmed];
}
const loopPromptVisiting = new Set();
function loopInputPromptItems(node){
    if(!node?.showPrompt) return [];
    if(loopPromptVisiting.has(node.id)) return [];
    loopPromptVisiting.add(node.id);
    try {
        const items = [];
        connections.filter(c => c.to === node.id)
            .map(c => nodes.find(n => n.id === c.from))
            .filter(Boolean)
            .forEach(n => {
                let text = '';
                if(n.type === 'prompt') {
                    if((n.text || '').trim()) items.push((n.text || '').trim());
                    return;
                }
                else if(n.type === 'promptGroup') {
                    const parts = (n.items || []).map(id => nodes.find(x => x.id === id)).filter(Boolean).map(p => p.text || '').filter(Boolean);
                    parts.forEach(part => {
                        const text = String(part || '').trim();
                        if(text) items.push(text);
                    });
                    return;
                }
                else if(n.type === 'loop') text = renderLoopPrompt(n);
                else if(n.type === 'llm') text = n.outputText || '';
                if(String(text || '').trim()) items.push(String(text || '').trim());
            });
        return items;
    } finally {
        loopPromptVisiting.delete(node.id);
    }
}
function loopInputPrompt(node, ctx=loopContext){
    const items = loopInputPromptItems(node);
    if(!items.length) return '';
    const startBase = Math.max(1, Number(node?.loopStart) || 1);
    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
    return items[(currentIndex - 1) % items.length];
}
function renderLoopPrompt(node, ctx=loopContext){
    if(!node?.showPrompt) return '';
    const variable = String(node?.variablePrompt || '').trim();
    const count = loopCount(node);
    const index = Math.max(1, Number(ctx?.index || 1) || 1);
    const total = Math.max(1, Number(ctx?.total || count) || count);
    const replaceVars = text => String(text || '')
        .replaceAll('《计数》', String(index))
        .replaceAll('《总数》', String(total))
        .replaceAll('《进度》', `${index}/${total}`)
        .replaceAll(`[${tr('canvas.counterToken')}]`, String(index))
        .replaceAll(`[${tr('canvas.totalToken')}]`, String(total))
        .replaceAll(`[${tr('canvas.progressToken')}]`, `${index}/${total}`);
    const selected = loopInputPrompt(node, ctx);
    if(selected) return replaceVars(selected);
    return replaceVars(variable);
}
function imageRefsFromNode(node){
    if(!node) return [];
    if(node.type === 'image' && node.url && mediaKindForNode(node) === 'image') return [{url:node.url, name:node.name || 'image', role:node.role || '', kind:'image'}];
    if(node.type === 'group'){
        return (node.items || [])
            .map(id => nodes.find(x => x.id === id))
            .filter(x => x?.type === 'image' && x?.url && mediaKindForNode(x) === 'image')
            .map(img => ({url:img.url, name:img.name || 'image', role:img.role || '', kind:'image'}));
    }
    if(node.type === 'output'){
        return (node.images || [])
            .map(outputUrlValue)
            .filter(url => url && !isVideoUrl(url) && !isAudioUrl(url))
            .map((url, i) => ({url, name:outputImageName(url) || `output-${i + 1}.png`, kind:'image'}));
    }
    if(CANVAS_IMAGE_OUTPUT_TYPES.includes(node.type)) return generatedImageRefs(node).filter(ref => ref.kind === 'image');
    return [];
}
function loopInputImageRefs(node, ctx=loopContext){
    if(!node?.imageInput) return [];
    const allRefs = connections
        .filter(c => c.to === node.id)
        .flatMap(c => imageRefsFromNode(nodes.find(n => n.id === c.from)))
        .filter(ref => ref?.url);
    if(!allRefs.length) return [];
    const startBase = Math.max(1, Number(node.loopStart) || 1);
    const batchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
    const start = Math.max(0, currentIndex - 1);
    return allRefs.slice(start, start + batchSize);
}
function videoRefsFromNode(node){
    if(!node) return [];
    if(node.type === 'image' && node.url && mediaKindForNode(node) === 'video') return [{url:node.url, name:node.name || 'video', role:node.role || '', kind:'video'}];
    if(node.type === 'group'){
        return (node.items || [])
            .map(id => nodes.find(x => x.id === id))
            .filter(x => x?.type === 'image' && x?.url && mediaKindForNode(x) === 'video')
            .map(vid => ({url:vid.url, name:vid.name || 'video', role:vid.role || '', kind:'video'}));
    }
    if(node.type === 'output'){
        return (node.images || [])
            .map((item, i) => ({item, i}))
            .filter(({item}) => mediaKindForOutputItem(item) === 'video')
            .map(({item, i}) => {
                const url = outputUrlValue(item);
                if(!url) return null;
                return {url, name:outputImageName(url) || `output-${i + 1}.mp4`, kind:'video', nodeId:node.id, outputIndex:i};
            })
            .filter(Boolean);
    }
    if(CANVAS_MEDIA_OUTPUT_TYPES.includes(node.type)) return generatedImageRefs(node).filter(ref => ref.kind === 'video');
    return [];
}
function loopInputVideoRefs(node, ctx=loopContext){
    if(!node?.videoInput) return [];
    const allRefs = connections
        .filter(c => c.to === node.id)
        .flatMap(c => videoRefsFromNode(nodes.find(n => n.id === c.from)))
        .filter(ref => ref?.url);
    if(!allRefs.length) return [];
    const startBase = Math.max(1, Number(node.loopStart) || 1);
    const batchSize = Math.max(1, Math.min(100, Number(node.videoBatchSize) || 1));
    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
    const start = Math.max(0, currentIndex - 1);
    return allRefs.slice(start, start + batchSize);
}
function loopTokenLabel(token){
    if(token === '《计数》') return tr('canvas.counterToken');
    if(token === '《总数》') return tr('canvas.totalToken');
    if(token === '《进度》') return tr('canvas.progressToken');
    return token;
}
function autoSizeLoopNode(node, opening){
    if(!node) return;
    if(opening){
        node.w = Math.max(Number(node.w || 0), 336);
        node.h = Math.max(Number(node.h || 0), 360);
    } else {
        node.w = Math.min(Number(node.w || 336), 336);
        delete node.h;
    }
}
function autoSizeLoopForPanels(node){
    if(!node) return;
    node.w = Math.max(Number(node.w || 0), 336);
    const panels = (node.showPrompt ? 1 : 0) + (node.imageInput ? 1 : 0);
    if(panels === 0) { delete node.h; return; }
    if(panels === 1) node.h = node.showPrompt ? 330 : 320;
    else if(panels === 2) node.h = (node.showPrompt && node.imageInput) ? 390 : 380;
    else node.h = 460;
}
function loopTokenChipHtml(token){
    return `<span class="loop-token-chip" contenteditable="false" data-token="${escapeAttr(token)}"><span>${escapeHtml(loopTokenLabel(token))}</span><button type="button" aria-label="${tr('common.delete')}" title="${tr('common.delete')}">×</button></span>`;
}
function loopVariableHtml(text){
    const token = '《计数》';
    return String(text || '').split(token).map((part, i) => `${i ? loopTokenChipHtml(token) : ''}${escapeHtml(part)}`).join('');
}
function loopEditorText(editor){
    const walk = node => {
        if(node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if(node.nodeType !== Node.ELEMENT_NODE) return '';
        if(node.classList?.contains('loop-token-chip')) return node.dataset.token || '';
        if(node.tagName === 'BR') return '\n';
        return [...node.childNodes].map(walk).join('');
    };
    return [...(editor?.childNodes || [])].map(walk).join('').replace(/\u00a0/g, ' ');
}
function insertLoopToken(editor, token){
    if(!editor) return;
    editor.focus();
    const chipWrap = document.createElement('span');
    chipWrap.innerHTML = loopTokenChipHtml(token);
    const chip = chipWrap.firstElementChild;
    const spacer = document.createTextNode(' ');
    const sel = window.getSelection();
    if(sel && sel.rangeCount && editor.contains(sel.anchorNode)){
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(spacer);
        range.insertNode(chip);
        range.setStartAfter(spacer);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        editor.appendChild(chip);
        editor.appendChild(spacer);
    }
}
function promptTextLength(text){
    return Array.from(String(text || '')).length;
}
function promptCounterHtml(text){
    const count = promptTextLength(text);
    const over = count > PROMPT_TEXT_MAX_LENGTH;
    return `<div class="prompt-counter ${over ? 'over' : ''}"><span>${count.toLocaleString()}</span><span>/ ${PROMPT_TEXT_MAX_LENGTH.toLocaleString()}</span></div>`;
}
function refreshPromptCounter(container, text){
    const counter = container?.querySelector('.prompt-counter');
    if(!counter) return;
    const count = promptTextLength(text);
    counter.classList.toggle('over', count > PROMPT_TEXT_MAX_LENGTH);
    counter.innerHTML = `<span>${count.toLocaleString()}</span><span>/ ${PROMPT_TEXT_MAX_LENGTH.toLocaleString()}</span>`;
}
function classicAssetPanelHost(){
    return {
        get LOCAL_CANVAS_ASSET_LIBRARY_ID(){return LOCAL_CANVAS_ASSET_LIBRARY_ID;},
        get activeCanvasAssetCategoryId(){return activeCanvasAssetCategoryId;},
        set activeCanvasAssetCategoryId(value){activeCanvasAssetCategoryId=value;},
        get activeCanvasAssetLibraryId(){return activeCanvasAssetLibraryId;},
        set activeCanvasAssetLibraryId(value){activeCanvasAssetLibraryId=value;},
        get activeCanvasWorkflowCategoryId(){return activeCanvasWorkflowCategoryId;},
        get assetManagerModal(){return assetManagerModal;},
        get canvasAssetAddCategoryBtn(){return canvasAssetAddCategoryBtn;},
        get canvasAssetCategorySelect(){return canvasAssetCategorySelect;},
        get canvasAssetDropZone(){return canvasAssetDropZone;},
        get canvasAssetGrid(){return canvasAssetGrid;},
        get canvasAssetHoverPreview(){return canvasAssetHoverPreview;},
        get canvasAssetLibrary(){return canvasAssetLibrary;},
        set canvasAssetLibrary(value){canvasAssetLibrary=value;},
        get canvasAssetLibraryOpen(){return canvasAssetLibraryOpen;},
        set canvasAssetLibraryOpen(value){canvasAssetLibraryOpen=value;},
        get canvasAssetLibrarySelect(){return canvasAssetLibrarySelect;},
        get canvasAssetPanel(){return canvasAssetPanel;},
        get canvasAssetToggle(){return canvasAssetToggle;},
        get localCanvasAssetLibrary(){return localCanvasAssetLibrary;},
        set localCanvasAssetLibrary(value){localCanvasAssetLibrary=value;},
        get managerSelectedAssetIds(){return managerSelectedAssetIds;},
        get managerSelectedWorkflowIds(){return managerSelectedWorkflowIds;},
        get window(){return window;},
        get workflowTransferModal(){return workflowTransferModal;},
        bindCanvasPreviewImageFallbacks:(...args)=>bindCanvasPreviewImageFallbacks(...args),
        canvasMediaPreviewUrl:(...args)=>canvasMediaPreviewUrl(...args),
        canvasPreviewImgHtml:(...args)=>canvasPreviewImgHtml(...args),
        canvasVideoPreviewHtml:(...args)=>canvasVideoPreviewHtml(...args),
        closeWorkflowTransferModal:(...args)=>closeWorkflowTransferModal(...args),
        createImageCardFromUrl:(...args)=>createImageCardFromUrl(...args),
        defaultPoint:(...args)=>defaultPoint(...args),
        escapeAttr:(...args)=>escapeAttr(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        importWorkflowAssetUrl:(...args)=>importWorkflowAssetUrl(...args),
        isAudioUrl:(...args)=>isAudioUrl(...args),
        isVideoUrl:(...args)=>isVideoUrl(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        renderAssetManager:(...args)=>renderAssetManager(...args),
        setStatus:(...args)=>setStatus(...args)
    };
}
function canvasAssetLibraries(){
    return CanvasAssetPanel.canvasAssetLibraries(classicAssetPanelHost());
}
function localCanvasAssetFolderCategories(){
    return CanvasAssetPanel.localCanvasAssetFolderCategories(classicAssetPanelHost());
}
function canvasAssetLibraryIsLocal(){
    return CanvasAssetPanel.canvasAssetLibraryIsLocal(classicAssetPanelHost());
}
function canvasAssetSourceLibraries(){
    return CanvasAssetPanel.canvasAssetSourceLibraries(classicAssetPanelHost());
}
function activeCanvasAssetLibrary(){
    return CanvasAssetPanel.activeCanvasAssetLibrary(classicAssetPanelHost());
}
function canvasAssetCategories(){
    return CanvasAssetPanel.canvasAssetCategories(classicAssetPanelHost());
}
function canvasMediaCategories(){
    return CanvasAssetPanel.canvasMediaCategories(classicAssetPanelHost());
}
function activeCanvasAssetCategory(){
    return CanvasAssetPanel.activeCanvasAssetCategory(classicAssetPanelHost());
}
function activeCanvasMediaCategory(){
    return CanvasAssetPanel.activeCanvasMediaCategory(classicAssetPanelHost());
}
function canvasWorkflowCategories(){
    return CanvasAssetPanel.canvasWorkflowCategories(classicAssetPanelHost());
}
function activeCanvasWorkflowCategory(){
    return CanvasAssetPanel.activeCanvasWorkflowCategory(classicAssetPanelHost());
}
function currentCanvasAssetItem(itemId){
    return CanvasAssetPanel.currentCanvasAssetItem(classicAssetPanelHost(), itemId);
}
function canvasAssetItemKind(item){
    return CanvasAssetPanel.canvasAssetItemKind(classicAssetPanelHost(), item);
}
function canvasAssetThumbHtml(item){
    return CanvasAssetPanel.canvasAssetThumbHtml(classicAssetPanelHost(), item);
}
function positionCanvasAssetHoverPreview(event){
    return CanvasAssetPanel.positionCanvasAssetHoverPreview(classicAssetPanelHost(), event);
}
function showCanvasAssetHoverPreview(event, item){
    return CanvasAssetPanel.showCanvasAssetHoverPreview(classicAssetPanelHost(), event, item);
}
function hideCanvasAssetHoverPreview(){
    return CanvasAssetPanel.hideCanvasAssetHoverPreview(classicAssetPanelHost());
}
async function renameCanvasAssetItem(itemId){
    return CanvasAssetPanel.renameCanvasAssetItem(classicAssetPanelHost(), itemId);
}
async function deleteCanvasAssetItem(itemId){
    return CanvasAssetPanel.deleteCanvasAssetItem(classicAssetPanelHost(), itemId);
}
async function loadCanvasAssetLibrary({renderPanel=true}={}){
    return CanvasAssetPanel.loadCanvasAssetLibrary(classicAssetPanelHost(), arguments[0]);
}
function renderCanvasAssetLibrary(){
    return CanvasAssetPanel.renderCanvasAssetLibrary(classicAssetPanelHost());
}
function toggleCanvasAssetLibrary(open=!canvasAssetLibraryOpen){
    return CanvasAssetPanel.toggleCanvasAssetLibrary(classicAssetPanelHost(), open);
}
async function addUrlToCanvasAssetLibrary(url, name=''){
    return CanvasAssetPanel.addUrlToCanvasAssetLibrary(classicAssetPanelHost(), url, name);
}
async function uploadFilesToLibrary(files, libraryId, categoryId){
    return CanvasAssetPanel.uploadFilesToLibrary(classicAssetPanelHost(), files, libraryId, categoryId);
}
function openAssetManager(){
    return CanvasAssetManager.openAssetManager(classicAssetManagerHost());
}
function closeAssetManager(){
    return CanvasAssetManager.closeAssetManager(classicAssetManagerHost());
}
window.closeAssetManager = closeAssetManager;
function renderAssetManager(){
    return CanvasAssetManager.renderAssetManager(classicAssetManagerHost());
}
function renderImageAssetManager(){
    return CanvasAssetManager.renderImageAssetManager(classicAssetManagerHost());
}
function workflowAssetThumbHtml(item){
    return CanvasAssetManager.workflowAssetThumbHtml(classicAssetManagerHost(), item);
}
function renderWorkflowAssetManager(){
    return CanvasAssetManager.renderWorkflowAssetManager(classicAssetManagerHost());
}
function renderPromptAssetManager(){
    return CanvasAssetManager.renderPromptAssetManager(classicAssetManagerHost());
}
function classicPromptTemplateHost(){
    return {
        get CANVAS_PROMPT_TEMPLATE_GROUPS_KEY(){return CANVAS_PROMPT_TEMPLATE_GROUPS_KEY;},
        get CANVAS_PROMPT_TEMPLATE_OVERRIDES_KEY(){return CANVAS_PROMPT_TEMPLATE_OVERRIDES_KEY;},
        get activePromptLibraryId(){return activePromptLibraryId;},
        set activePromptLibraryId(value){activePromptLibraryId=value;},
        get canvasAssistantTemplateCallback(){return canvasAssistantTemplateCallback;},
        set canvasAssistantTemplateCallback(value){canvasAssistantTemplateCallback=value;},
        get canvasPromptLibraries(){return canvasPromptLibraries;},
        set canvasPromptLibraries(value){canvasPromptLibraries=value;},
        get canvasPromptTemplateOverrides(){return canvasPromptTemplateOverrides;},
        set canvasPromptTemplateOverrides(value){canvasPromptTemplateOverrides=value;},
        get canvasPromptTemplates(){return canvasPromptTemplates;},
        set canvasPromptTemplates(value){canvasPromptTemplates=value;},
        get canvasPromptTemplatesLoaded(){return canvasPromptTemplatesLoaded;},
        set canvasPromptTemplatesLoaded(value){canvasPromptTemplatesLoaded=value;},
        get document(){return document;},
        get localStorage(){return localStorage;},
        get nodes(){return nodes;},
        get promptTemplateBody(){return promptTemplateBody;},
        get promptTemplateCategory(){return promptTemplateCategory;},
        set promptTemplateCategory(value){promptTemplateCategory=value;},
        get promptTemplateCats(){return promptTemplateCats;},
        get promptTemplateEditing(){return promptTemplateEditing;},
        set promptTemplateEditing(value){promptTemplateEditing=value;},
        get promptTemplateGroupEditMode(){return promptTemplateGroupEditMode;},
        get promptTemplateGroups(){return promptTemplateGroups;},
        set promptTemplateGroups(value){promptTemplateGroups=value;},
        get promptTemplateLibrarySelect(){return promptTemplateLibrarySelect;},
        get promptTemplateModal(){return promptTemplateModal;},
        get promptTemplateNodeId(){return promptTemplateNodeId;},
        set promptTemplateNodeId(value){promptTemplateNodeId=value;},
        get promptTemplatePanel(){return promptTemplatePanel;},
        get promptTemplateQuery(){return promptTemplateQuery;},
        set promptTemplateQuery(value){promptTemplateQuery=value;},
        get promptTemplateSearch(){return promptTemplateSearch;},
        get promptTemplateSelectedId(){return promptTemplateSelectedId;},
        set promptTemplateSelectedId(value){promptTemplateSelectedId=value;},
        get window(){return window;},
        escapeAttr:(...args)=>escapeAttr(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        langIsEn:(...args)=>langIsEn(...args),
        refreshGeneratorInputViews:(...args)=>refreshGeneratorInputViews(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        render:(...args)=>render(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setStatus:(...args)=>setStatus(...args),
        syncGeneratorInputs:(...args)=>syncGeneratorInputs(...args),
        tr:(...args)=>tr(...args)
    };
}
async function loadCanvasPromptTemplates(){
    return CanvasPromptTemplate.loadCanvasPromptTemplates(classicPromptTemplateHost());
}
function activeCanvasPromptLibrary(){
    return CanvasPromptTemplate.activeCanvasPromptLibrary(classicPromptTemplateHost());
}
function defaultCanvasPromptTemplateGroups(){
    return CanvasPromptTemplate.defaultCanvasPromptTemplateGroups(classicPromptTemplateHost());
}
function loadCanvasPromptTemplateGroups(){
    return CanvasPromptTemplate.loadCanvasPromptTemplateGroups(classicPromptTemplateHost());
}
function loadCanvasPromptTemplateOverrides(){
    return CanvasPromptTemplate.loadCanvasPromptTemplateOverrides(classicPromptTemplateHost());
}
function saveCanvasPromptTemplateOverrides(){
    return CanvasPromptTemplate.saveCanvasPromptTemplateOverrides(classicPromptTemplateHost());
}
function activeCanvasPromptLibraryItems(){
    return CanvasPromptTemplate.activeCanvasPromptLibraryItems(classicPromptTemplateHost());
}
function refreshCanvasPromptTemplatesFromLibraries(){
    return CanvasPromptTemplate.refreshCanvasPromptTemplatesFromLibraries(classicPromptTemplateHost());
}
function renderCanvasPromptLibrarySelect(){
    return CanvasPromptTemplate.renderCanvasPromptLibrarySelect(classicPromptTemplateHost());
}
function activeCanvasPromptTemplateGroups(){
    return CanvasPromptTemplate.activeCanvasPromptTemplateGroups(classicPromptTemplateHost());
}
function canvasPromptTemplateCategoryLabel(category){
    return CanvasPromptTemplate.canvasPromptTemplateCategoryLabel(classicPromptTemplateHost(), category);
}
function selectedCanvasPromptTemplateGroupIsLegacy(){
    return CanvasPromptTemplate.selectedCanvasPromptTemplateGroupIsLegacy(classicPromptTemplateHost());
}
function canvasPromptTemplateIsLegacy(item){
    return CanvasPromptTemplate.canvasPromptTemplateIsLegacy(classicPromptTemplateHost(), item);
}
function canvasPromptTemplateName(template){
    return CanvasPromptTemplate.canvasPromptTemplateName(classicPromptTemplateHost(), template);
}
function canvasPromptTemplateScene(template){
    return CanvasPromptTemplate.canvasPromptTemplateScene(classicPromptTemplateHost(), template);
}
function canvasPromptTemplateText(template, mode='positive'){
    return CanvasPromptTemplate.canvasPromptTemplateText(classicPromptTemplateHost(), template, mode);
}
function canvasPromptTemplateSearchText(template){
    return CanvasPromptTemplate.canvasPromptTemplateSearchText(classicPromptTemplateHost(), template);
}
function canvasPromptTemplateVisibleItems(){
    return CanvasPromptTemplate.canvasPromptTemplateVisibleItems(classicPromptTemplateHost());
}
function currentCanvasPromptTemplateLibraryEditable(){
    return CanvasPromptTemplate.currentCanvasPromptTemplateLibraryEditable(classicPromptTemplateHost());
}
function currentCanvasPromptTemplateNodeText(){
    return CanvasPromptTemplate.currentCanvasPromptTemplateNodeText(classicPromptTemplateHost());
}
function syncCanvasPromptTemplateButtons(){
    return CanvasPromptTemplate.syncCanvasPromptTemplateButtons(classicPromptTemplateHost());
}
function canvasPromptTemplateDefaultName(text){
    return CanvasPromptTemplate.canvasPromptTemplateDefaultName(classicPromptTemplateHost(), text);
}
function selectedCanvasPromptTemplate(){
    return CanvasPromptTemplate.selectedCanvasPromptTemplate(classicPromptTemplateHost());
}
function syncCanvasPromptTemplateMutation(data, fallbackSelectedId=''){
    return CanvasPromptTemplate.syncCanvasPromptTemplateMutation(classicPromptTemplateHost(), data, fallbackSelectedId);
}
async function saveCurrentCanvasPromptAsTemplate(){
    return CanvasPromptTemplate.saveCurrentCanvasPromptAsTemplate(classicPromptTemplateHost());
}
async function createBlankCanvasPromptTemplate(){
    return CanvasPromptTemplate.createBlankCanvasPromptTemplate(classicPromptTemplateHost());
}
async function saveCanvasPromptTemplateEdit(){
    return CanvasPromptTemplate.saveCanvasPromptTemplateEdit(classicPromptTemplateHost());
}
async function deleteCanvasPromptTemplate(){
    return CanvasPromptTemplate.deleteCanvasPromptTemplate(classicPromptTemplateHost());
}
function promptTemplateScrollSnapshot(){
    return CanvasPromptTemplate.promptTemplateScrollSnapshot(classicPromptTemplateHost());
}
function restorePromptTemplateScroll(snapshot){
    return CanvasPromptTemplate.restorePromptTemplateScroll(classicPromptTemplateHost(), snapshot);
}
async function createCanvasPromptTemplateGroup(){
    return CanvasPromptTemplate.createCanvasPromptTemplateGroup(classicPromptTemplateHost());
}
async function renameCanvasPromptTemplateGroup(groupId){
    return CanvasPromptTemplate.renameCanvasPromptTemplateGroup(classicPromptTemplateHost(), groupId);
}
async function deleteCanvasPromptTemplateGroup(groupId){
    return CanvasPromptTemplate.deleteCanvasPromptTemplateGroup(classicPromptTemplateHost(), groupId);
}
function renderPromptTemplateModal(){
    return CanvasPromptTemplate.renderPromptTemplateModal(classicPromptTemplateHost());
}
async function openPromptTemplateModal(nodeId){
    return CanvasPromptTemplate.openPromptTemplateModal(classicPromptTemplateHost(), nodeId);
}
function closePromptTemplateModal(){
    return CanvasPromptTemplate.closePromptTemplateModal(classicPromptTemplateHost());
}
function applyPromptTemplateToPromptNode(mode='positive'){
    return CanvasPromptTemplate.applyPromptTemplateToPromptNode(classicPromptTemplateHost(), mode);
}
function renderLoopBody(node){
    return CanvasTextView.renderLoopBody(classicNodeViewHost(), node);
}
function renderLLMBody(node){
    return CanvasTextView.renderLLMBody(classicNodeViewHost(), node);
}
function renderLLMNodePane(container, node){
    return CanvasTextView.renderLLMNodePane(classicNodeViewHost(), container, node);
}
function renderLLMChatPane(container, node){
    return CanvasTextView.renderLLMChatPane(classicNodeViewHost(), container, node);
}
function bindScrollableText(el){
    return classicTextSelection.bind(el);
}
function startLLMPaneResize(e, node){
    e.preventDefault();
    e.stopPropagation();
    llmPaneDrag = {
        node,
        sy:e.clientY,
        inputStart:Math.max(70, node.llmInputHeight || 110),
        outputStart:Math.max(70, node.llmOutputHeight || 150)
    };
    setCanvasMouseMove(onLLMPaneResize);
    setCanvasMouseUp(endDrag);
}
function onLLMPaneResize(e){
    if(!llmPaneDrag) return;
    const total = llmPaneDrag.inputStart + llmPaneDrag.outputStart;
    const delta = (e.clientY - llmPaneDrag.sy) / viewport.scale;
    const minPane = 70;
    const nextInput = Math.max(minPane, Math.min(total - minPane, llmPaneDrag.inputStart + delta));
    const nextOutput = Math.max(minPane, total - nextInput);
    llmPaneDrag.node.llmInputHeight = Math.round(nextInput);
    llmPaneDrag.node.llmOutputHeight = Math.round(nextOutput);
    const el = nodesEl.querySelector(`.node[data-id="${llmPaneDrag.node.id}"]`);
    if(el){
        const inputEl = el.querySelector('.llm-input-output');
        const outputEl = el.querySelector('.llm-result-output');
        if(inputEl){
            inputEl.style.height = `${llmPaneDrag.node.llmInputHeight}px`;
            inputEl.style.flexBasis = `${llmPaneDrag.node.llmInputHeight}px`;
        }
        if(outputEl){
            outputEl.style.height = `${llmPaneDrag.node.llmOutputHeight}px`;
            outputEl.style.flexBasis = `${llmPaneDrag.node.llmOutputHeight}px`;
        }
    }
}
function llmInputText(node){
    return connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean).map(n => {
        if(n.type === 'prompt') return n.text || '';
        if(n.type === 'loop') return renderLoopPrompt(n);
        if(n.type === 'promptGroup') return (n.items || []).map(id => nodes.find(x => x.id === id)).filter(Boolean).map(p => p.text || '').filter(Boolean).join('\n\n');
        if(n.type==='generator' || n.type==='output')return n.audioOutputText || '';
        if(n.type === 'llm') return n.outputText || '';
        return '';
    }).filter(Boolean).join('\n\n');
}
function llmInputImages(node){
    const urls = [];
    connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean).forEach(n => {
        if(n.type === 'image' && n.url && mediaKindForNode(n) === 'image') urls.push(n.url);
        if(n.type === 'output' && (n.images||[]).length){
            const last = [...n.images].reverse().map(outputUrlValue).find(url => url && !isVideoUrl(url) && !isAudioUrl(url));
            if(last) urls.push(last);
        }
        if(n.type === 'group'){
            (n.items || []).map(id => nodes.find(x => x.id === id)).filter(x => x?.type === 'image' && x?.url && mediaKindForNode(x) === 'image').forEach(img => urls.push(img.url));
        }
    });
    return urls;
}
function llmInputVideos(node){
    const urls = [];
    connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean).forEach(n => {
        if(n.type === 'image' && n.url && mediaKindForNode(n) === 'video') urls.push(n.url);
        if(n.type === 'output' && (n.images||[]).length){
            const last = [...n.images].reverse().map(outputUrlValue).find(url => url && isVideoUrl(url));
            if(last) urls.push(last);
        }
        if(n.type === 'group'){
            (n.items || []).map(id => nodes.find(x => x.id === id)).filter(x => x?.type === 'image' && x?.url && mediaKindForNode(x) === 'video').forEach(video => urls.push(video.url));
        }
    });
    return urls;
}
function llmInputAudios(node){
    const urls = [];
    connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean).forEach(n => {
        if(n.type === 'audio' && n.url) urls.push(n.url);
        if(n.type === 'generator' && (n.generatedOutputs || []).length){
            const item = [...n.generatedOutputs].reverse().find(output => mediaKindForOutputItem(output) === 'audio' && outputUrlValue(output));
            if(item) urls.push(outputUrlValue(item));
        }
        if(n.type === 'output' && (n.images||[]).length){
            const last = [...n.images].reverse().map(outputUrlValue).find(url => url && isAudioUrl(url));
            if(last) urls.push(last);
        }
        if(n.type === 'group'){
            (n.items || []).map(id => nodes.find(x => x.id === id)).filter(x => x?.url && mediaKindForNode(x) === 'audio').forEach(audio => urls.push(audio.url));
        }
    });
    return [...new Set(urls)];
}
function renderGeneratorBody(node){
    return CanvasGenerationView.renderGeneratorBody(classicNodeViewHost(), node);
}
function midjourneyModalHtml(node, maskRef){
    return CanvasGenerationView.midjourneyModalHtml(classicNodeViewHost(), node, maskRef);
}
function midjourneyContinuationHtml(node){
    return CanvasGenerationView.midjourneyContinuationHtml(classicNodeViewHost(), node);
}
function renderMidjourneyBody(node){
    return CanvasGenerationView.renderMidjourneyBody(classicNodeViewHost(), node);
}
function renderVideoBody(node){
    return CanvasGenerationView.renderVideoBody(classicNodeViewHost(), node);
}


























function renderPromptPreview(container, promptInputs){
    if(!container) return;
    const html = promptInputs.length ? `<div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Prompts</div>${promptInputs.map(src => `<div class="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 line-clamp-2">${escapeHtml(src.label)}</div>`).join('')}` : '';
    if(container.innerHTML !== html) container.innerHTML = html;
}
function classicInputViewHost(){
    return {
        get document(){return document;},
        get internalDrag(){return internalDrag;},
        set internalDrag(value){internalDrag=value;},
        bindCanvasPreviewImageFallbacks:(...args)=>bindCanvasPreviewImageFallbacks(...args),
        canvasPreviewImgHtml:(...args)=>canvasPreviewImgHtml(...args),
        canvasVideoPreviewHtml:(...args)=>canvasVideoPreviewHtml(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        isMissingAssetUrl:(...args)=>isMissingAssetUrl(...args),
        mediaKindForRef:(...args)=>mediaKindForRef(...args),
        missingAssetHtml:(...args)=>missingAssetHtml(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        reorderInput:(...args)=>reorderInput(...args),
        tr:(...args)=>tr(...args)
    };
}
function canvasInputListNeedsRender(list, signature){
    return CanvasInputView.canvasInputListNeedsRender(classicInputViewHost(), list, signature);
}
function renderImageInputList(list, node, imageInputs, emptyText=null){
    return CanvasInputView.renderImageInputList(classicInputViewHost(), list, node, imageInputs, emptyText);
}
function renderVideoImageInputs(list, node, imageInputs){
    return CanvasInputView.renderVideoImageInputs(classicInputViewHost(), list, node, imageInputs);
}
function comfyWorkflowOptions(selected){
    return CanvasWorkflowView.comfyWorkflowOptions(classicNodeViewHost(), selected);
}
function hasComfyWorkflow(name){
    return CanvasWorkflowConfig.hasComfyWorkflow(classicWorkflowConfigHost(), name);
}
function validComfyWorkflowName(name){
    return CanvasWorkflowConfig.validComfyWorkflowName(classicWorkflowConfigHost(), name);
}
function pruneMissingComfyWorkflows(){
    return CanvasWorkflowConfig.pruneMissingComfyWorkflows(classicWorkflowConfigHost());
}
function currentComfyWorkflow(node){
    return CanvasWorkflowConfig.currentComfyWorkflow(classicWorkflowConfigHost(), node);
}
async function ensureComfyWorkflow(name){
    return CanvasWorkflowConfig.ensureComfyWorkflow(classicWorkflowConfigHost(), name);
}
function validRunningHubWorkflowId(workflowId){
    return CanvasWorkflowConfig.validRunningHubWorkflowId(classicWorkflowConfigHost(), workflowId);
}
function currentRunningHubWorkflow(node){
    return CanvasWorkflowConfig.currentRunningHubWorkflow(classicWorkflowConfigHost(), node);
}
async function ensureRunningHubWorkflow(workflowId){
    return CanvasWorkflowConfig.ensureRunningHubWorkflow(classicWorkflowConfigHost(), workflowId);
}
function comfyFieldKind(f){
    return CanvasWorkflowParams.comfyFieldKind(classicWorkflowParamsHost(), f);
}
function comfyFields(node, kind='all'){
    return CanvasWorkflowParams.comfyFields(classicWorkflowParamsHost(), node, kind);
}
function comfyParamValue(node, field){
    return CanvasWorkflowParams.comfyParamValue(classicWorkflowParamsHost(), node, field);
}
function comfyRandomEnabled(field){
    return CanvasWorkflowParams.comfyRandomEnabled(classicWorkflowParamsHost(), field);
}
function comfyRandomActive(node, fieldId){
    return CanvasWorkflowParams.comfyRandomActive(classicWorkflowParamsHost(), node, fieldId);
}
function comfyRandomValue(field){
    return CanvasWorkflowParams.comfyRandomValue(classicWorkflowParamsHost(), field);
}
function toggleComfyRandom(nodeId, fieldId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const field = comfyFields(node).find(f => f.id === fieldId);
    if(!comfyRandomEnabled(field)) return;
    node.comfyRandomActive = node.comfyRandomActive || {};
    node.comfyRandomActive[fieldId] = !comfyRandomActive(node, fieldId);
    refreshNodes([node.id]);
    scheduleSave();
}
function renderComfyBody(node){
    return CanvasWorkflowView.renderComfyBody(classicNodeViewHost(), node);
}
function renderComfyImages(list, node, imageInputs){
    return CanvasWorkflowView.renderComfyImages(classicNodeViewHost(), list, node, imageInputs);
}
const RH_KNOWN_FIELD_OPTIONS = {
    aspectRatio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    aspect_ratio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    ratio:['1:1','16:9','9:16','21:9','9:21','4:3','3:4','4:5','5:4','3:2','2:3'],
    resolution:['1k','2k','4k','8k'],
    size:['512','768','1024','1280','1536','2048'],
    mode:['text2img','img2img'],
    quality:['low','medium','high','best'],
    instanceType:['default','plus','pro'],
    instance_type:['default','plus','pro'],
    precision:['fp16','fp32','bf16'],
    scheduler:['normal','karras','exponential','sgm_uniform','simple','ddim_uniform'],
    sampler:['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc']
};
function classicWorkflowParamsHost(){
    return {
        get RH_KNOWN_FIELD_OPTIONS(){return RH_KNOWN_FIELD_OPTIONS;},
        get runningHubWorkflowCache(){return runningHubWorkflowCache;},
        currentComfyWorkflow:(...args)=>currentComfyWorkflow(...args),
        currentRunningHubAppConfig:(...args)=>currentRunningHubAppConfig(...args),
        currentRunningHubWorkflowEntry:(...args)=>currentRunningHubWorkflowEntry(...args),
        ensureRunningHubWorkflowConfigForNode:(...args)=>ensureRunningHubWorkflowConfigForNode(...args),
        fetch:(...args)=>fetch(...args),
        rhMediaSources:(...args)=>rhMediaSources(...args),
        rhSelectedEntryRef:(...args)=>rhSelectedEntryRef(...args),
        tr:(...args)=>tr(...args),
        validRunningHubWorkflowId:(...args)=>validRunningHubWorkflowId(...args)
    };
}
function rhParamKey(nodeId, fieldName){
    return CanvasWorkflowParams.rhParamKey(classicWorkflowParamsHost(), nodeId, fieldName);
}
function rhFieldKind(field){
    return CanvasWorkflowParams.rhFieldKind(classicWorkflowParamsHost(), field);
}
function rhFieldRole(field){
    return CanvasWorkflowParams.rhFieldRole(classicWorkflowParamsHost(), field);
}
function rhExtractFieldOptions(field){
    return CanvasWorkflowParams.rhExtractFieldOptions(classicWorkflowParamsHost(), field);
}
function rhDefaultValue(field){
    return CanvasWorkflowParams.rhDefaultValue(classicWorkflowParamsHost(), field);
}
function rhRandomEnabled(field){
    return CanvasWorkflowParams.rhRandomEnabled(classicWorkflowParamsHost(), field);
}
function rhRandomActive(node, key){
    return CanvasWorkflowParams.rhRandomActive(classicWorkflowParamsHost(), node, key);
}
function toggleRhRandom(nodeId, key){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const field = rhActiveFields(node).find(f => rhParamKey(f.nodeId, f.fieldName) === key);
    if(!rhRandomEnabled(field)) return;
    node.rhRandomActive = node.rhRandomActive || {};
    node.rhRandomActive[key] = !rhRandomActive(node, key);
    refreshNodes([node.id]);
    scheduleSave();
}
function rhWorkflowNodeInfoList(data){
    return CanvasWorkflowParams.rhWorkflowNodeInfoList(classicWorkflowParamsHost(), data);
}
function rhInferWorkflowFieldType(fieldName, fieldValue){
    return CanvasWorkflowParams.rhInferWorkflowFieldType(classicWorkflowParamsHost(), fieldName, fieldValue);
}
function rhIsWorkflowLinkValue(value){
    return CanvasWorkflowParams.rhIsWorkflowLinkValue(classicWorkflowParamsHost(), value);
}
function classicWorkflowConfigHost(){
    return {
        get apiProviders(){return apiProviders;},
        get comfyWorkflowCache(){return comfyWorkflowCache;},
        get comfyWorkflows(){return comfyWorkflows;},
        get nodes(){return nodes;},
        get runningHubWorkflowCache(){return runningHubWorkflowCache;},
        alert:(...args)=>alert(...args),
        defaultApiImageResolution:(...args)=>defaultApiImageResolution(...args),
        fetch:(...args)=>fetch(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        render:(...args)=>render(...args),
        rhCurrentKind:(...args)=>rhCurrentKind(...args),
        rhDefaultValue:(...args)=>rhDefaultValue(...args),
        rhEntryFields:(...args)=>rhEntryFields(...args),
        rhParamKey:(...args)=>rhParamKey(...args),
        rhWorkflowJsonFromSources:(...args)=>rhWorkflowJsonFromSources(...args),
        rhWorkflowNodeInfoList:(...args)=>rhWorkflowNodeInfoList(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        tr:(...args)=>tr(...args),
        uniqueModels:(...args)=>uniqueModels(...args)
    };
}
function runningHubProvider(){
    return CanvasWorkflowConfig.runningHubProvider(classicWorkflowConfigHost());
}
function runningHubEntries(kind){
    return CanvasWorkflowConfig.runningHubEntries(classicWorkflowConfigHost(), kind);
}
function runningHubEntryId(entry, kind){
    return CanvasWorkflowConfig.runningHubEntryId(classicWorkflowConfigHost(), entry, kind);
}
function runningHubEntryLabel(entry, kind){
    return CanvasWorkflowConfig.runningHubEntryLabel(classicWorkflowConfigHost(), entry, kind);
}
function runningHubEntryKey(kind, id){
    return CanvasWorkflowConfig.runningHubEntryKey(classicWorkflowConfigHost(), kind, id);
}
function parseRunningHubEntryKey(value){
    return CanvasWorkflowConfig.parseRunningHubEntryKey(classicWorkflowConfigHost(), value);
}
function runningHubAllEntries(){
    return CanvasWorkflowConfig.runningHubAllEntries(classicWorkflowConfigHost());
}
function rhSelectedEntryRef(node){
    return CanvasWorkflowConfig.rhSelectedEntryRef(classicWorkflowConfigHost(), node);
}
function applyRhEntrySelection(node, ref){
    return CanvasWorkflowConfig.applyRhEntrySelection(classicWorkflowConfigHost(), node, ref);
}
function currentRunningHubAppConfig(node){
    return CanvasWorkflowConfig.currentRunningHubAppConfig(classicWorkflowConfigHost(), node);
}
function currentRunningHubWorkflowEntry(node){
    return CanvasWorkflowConfig.currentRunningHubWorkflowEntry(classicWorkflowConfigHost(), node);
}
function rhEntryFields(entry){
    return CanvasWorkflowParams.rhEntryFields(classicWorkflowParamsHost(), entry);
}
function rhWorkflowJsonFromSources(...sources){
    return CanvasWorkflowParams.rhWorkflowJsonFromSources(classicWorkflowParamsHost(), ...sources);
}
function rhCurrentEntry(node){
    return CanvasWorkflowParams.rhCurrentEntry(classicWorkflowParamsHost(), node);
}
function rhCurrentKind(node){
    return CanvasWorkflowParams.rhCurrentKind(classicWorkflowParamsHost(), node);
}
function ensureRhNodeSelection(node){
    return CanvasWorkflowConfig.ensureRhNodeSelection(classicWorkflowConfigHost(), node);
}
function rhEntryOptions(selected){
    const models = runningHubEntries('model');
    const apps = runningHubEntries('app');
    const workflows = runningHubEntries('workflow');
    if(!models.length && !apps.length && !workflows.length) return `<option value="">请先在 API 设置里添加 RunningHub 配置</option>`;
    const group = (kind, entries, label) => entries.length ? `
        <optgroup label="${label}">
            ${entries.map(entry => {
                const id = runningHubEntryId(entry, kind);
                const key = runningHubEntryKey(kind, id);
                return `<option value="${escapeAttr(key)}" ${String(selected || '') === key ? 'selected' : ''}>${escapeHtml(runningHubEntryLabel(entry, kind))}</option>`;
            }).join('')}
        </optgroup>
    ` : '';
    return `${group('model', models, '模型 API')}${group('app', apps, 'AI 应用')}${group('workflow', workflows, '工作流')}`;
}
function rhPaymentOptions(node){
    const provider = runningHubProvider();
    const selected = node.rhPayment === 'wallet' ? 'wallet' : 'free';
    return `
        <option value="free" ${selected === 'free' ? 'selected' : ''}>RunningHub币 Key${provider?.has_key ? '' : '（未配置）'}</option>
        <option value="wallet" ${selected === 'wallet' ? 'selected' : ''}>账户余额 Key${provider?.has_wallet_key ? '' : '（未配置）'}</option>
    `;
}
function rhUseWallet(node){
    return CanvasWorkflowParams.rhUseWallet(classicWorkflowParamsHost(), node);
}
function rhUsableFields(fields){
    return CanvasWorkflowParams.rhUsableFields(classicWorkflowParamsHost(), fields);
}
function rhActiveFields(node){
    return CanvasWorkflowParams.rhActiveFields(classicWorkflowParamsHost(), node);
}
function currentRunningHubWorkflowConfig(node){
    return CanvasWorkflowConfig.currentRunningHubWorkflowConfig(classicWorkflowConfigHost(), node);
}
async function ensureRunningHubWorkflowConfigForNode(node){
    return CanvasWorkflowConfig.ensureRunningHubWorkflowConfigForNode(classicWorkflowConfigHost(), node);
}
function rhMediaSources(node){
    const sources = orderedSources(node, generatorSources(node));
    const refs = sources.flatMap(src => src.refs || []).filter(ref => ref?.url);
    return {
        sources,
        refs,
        image:imageRefsOnly(refs),
        video:videoRefsOnly(refs),
        audio:audioRefsOnly(refs),
        prompt:sources.map(src => src.prompt).filter(Boolean).join('\n\n')
    };
}
function rhFieldIndexes(fields){
    return CanvasWorkflowParams.rhFieldIndexes(classicWorkflowParamsHost(), fields);
}
function rhFieldValue(node, field, media=null){
    return CanvasWorkflowParams.rhFieldValue(classicWorkflowParamsHost(), node, field, media);
}
function rhRequiredLabel(field){
    return CanvasWorkflowParams.rhRequiredLabel(classicWorkflowParamsHost(), field);
}
function rhPruneWorkflowForMissingFields(workflowJson, missingFields){
    return CanvasWorkflowParams.rhPruneWorkflowForMissingFields(classicWorkflowParamsHost(), workflowJson, missingFields);
}
async function rhBuildWorkflowRequestExtras(node, media, nodeInfoList){
    return CanvasWorkflowParams.rhBuildWorkflowRequestExtras(classicWorkflowParamsHost(), node, media, nodeInfoList);
}












function rhMediaPreviewHtml(ref, kind){
    return CanvasWorkflowView.rhMediaPreviewHtml(classicNodeViewHost(), ref, kind);
}
function renderRhBody(node){
    return CanvasWorkflowView.renderRhBody(classicNodeViewHost(), node);
}
function rhModelSettingsHtml(node){
    return CanvasWorkflowView.rhModelSettingsHtml(classicNodeViewHost(), node);
}
function bindRhModelControls(wrap, node, media){
    return CanvasWorkflowView.bindRhModelControls(classicNodeViewHost(), wrap, node, media);
}
function renderRhInputs(list, node, media){
    return CanvasWorkflowView.renderRhInputs(classicNodeViewHost(), list, node, media);
}
function renderRhPromptFields(container, node, fields){
    return CanvasWorkflowView.renderRhPromptFields(classicNodeViewHost(), container, node, fields);
}
function renderRhParams(container, node, fields, media){
    return CanvasWorkflowView.renderRhParams(classicNodeViewHost(), container, node, fields, media);
}
function renderRhSettingField(node, field, key, kind, label, value, options, wide=false){
    return CanvasWorkflowView.renderRhSettingField(classicNodeViewHost(), node, field, key, kind, label, value, options, wide);
}
function setCanvasWorkflowParameters(node, patch){
    if(node.type === 'rh'){
        node.rhParams = node.rhParams || {};
        for(const [key, value] of Object.entries(patch)) node.rhParams[key] = {...(node.rhParams[key] || {}), value:String(value)};
    }else if(node.type === 'comfy'){
        node.comfyParams = {...(node.comfyParams || {}), ...patch};
    }else throw new Error('不是原生工作流节点');
}
function bindRhParamControls(container, node){
    return CanvasWorkflowView.bindRhParamControls(classicNodeViewHost(), container, node);
}
async function rhFetchAppInfo(nodeId, showAlert=true){
    return CanvasWorkflowConfig.rhFetchAppInfo(classicWorkflowConfigHost(), nodeId, showAlert);
}
async function rhFetchWorkflowInfo(nodeId, showAlert=true){
    return CanvasWorkflowConfig.rhFetchWorkflowInfo(classicWorkflowConfigHost(), nodeId, showAlert);
}
async function rhImportWorkflowJson(nodeId, file){
    return CanvasWorkflowConfig.rhImportWorkflowJson(classicWorkflowConfigHost(), nodeId, file);
}
async function rhUploadValueIfNeeded(value, node=null){
    return CanvasWorkflowParams.rhUploadValueIfNeeded(classicWorkflowParamsHost(), value, node);
}
async function rhBuildNodeInfoList(node, media){
    return CanvasWorkflowParams.rhBuildNodeInfoList(classicWorkflowParamsHost(), node, media);
}
async function runRhNode(nodeId, opts={}){
    return CanvasProviderRunner.runRhNode(classicProviderHost(), nodeId, opts);
}
async function runRhModelNode(node, opts={}){
    return CanvasProviderRunner.runRhModelNode(classicProviderHost(), node, opts);
}
function renderComfySettings(container, node){
    return CanvasWorkflowView.renderComfySettings(classicNodeViewHost(), container, node);
}
function renderComfyCustomField(node, f){
    return CanvasWorkflowView.renderComfyCustomField(classicNodeViewHost(), node, f);
}
function updateComfyField(node, input, event){
    return CanvasWorkflowView.updateComfyField(classicNodeViewHost(), node, input, event);
}

const CANVAS_GENERATOR_TYPES = ['generator','midjourney','msgen','comfy','video','rh'];
const CANVAS_IMAGE_OUTPUT_TYPES = ['generator','midjourney','msgen','comfy','rh'];
const CANVAS_MEDIA_OUTPUT_TYPES = ['generator','midjourney','msgen','comfy','video','rh'];
function hasExplicitOutputConnection(nodeId){
    return connections.some(c => {
        if(c.from !== nodeId) return false;
        const to = nodes.find(n => n.id === c.to);
        return to?.type === 'output';
    });
}
function hasDownstreamGenerator(nodeId){
    return connections.some(c => {
        if(c.from !== nodeId) return false;
        const to = nodes.find(n => n.id === c.to);
        if(!to) return false;
        if(CANVAS_GENERATOR_TYPES.includes(to.type)) return true;
        if(to.type !== 'output') return false;
        return connections.some(cc => {
            if(cc.from !== to.id) return false;
            const next = nodes.find(n => n.id === cc.to);
            return next && CANVAS_GENERATOR_TYPES.includes(next.type);
        });
    });
}
function shouldCreateOutputForNode(node){
    if(!node) return false;
    if(hasExplicitOutputConnection(node.id)) return true;
    if(node.shotTableOrigin?.inlineOutput) return false;
    return !hasDownstreamGenerator(node.id);
}
function outputForNode(node, dx=460){
    if(!node || !shouldCreateOutputForNode(node)) return null;
    let out = connections
        .filter(c => c.from === node.id)
        .map(c => nodes.find(n => n.id === c.to))
        .find(n => n?.type === 'output');
    if(!out){
        out = {id:uid('out'), type:'output', x:node.x + dx, y:node.y, images:[]};
        nodes.push(out);
        connections.push({id:uid('c'), from:node.id, to:out.id});
    }
    return out;
}
function outputNodesForSource(nodeId){
    return connections
        .filter(c => c.from === nodeId)
        .map(c => nodes.find(n => n.id === c.to))
        .filter(n => n?.type === 'output');
}
function latestGeneratedOutputItem(node){
    return [...(node?.generatedOutputs || [])].reverse().find(item => outputUrlValue(item));
}
function classicTaskRuntimeHost(){
    return {
        pollCanvasImageTask:(...args)=>pollCanvasImageTask(...args),
        pollCanvasComfyTask:(...args)=>pollCanvasComfyTask(...args),
        pollCanvasVideoTask:(...args)=>pollCanvasVideoTask(...args),
        pollCanvasRunningHubTask:(...args)=>pollCanvasRunningHubTask(...args),
        appendOutputImages:(...args)=>appendOutputImages(...args),
        collectRunMeta:(...args)=>collectRunMeta(...args),
        completeCanvasComfyTask:(...args)=>completeCanvasComfyTask(...args),
        completeCanvasImageTask:(...args)=>completeCanvasImageTask(...args),
        completeCanvasVideoTask:(...args)=>completeCanvasVideoTask(...args),
        failCanvasImageTask:(...args)=>failCanvasImageTask(...args),
        findPendingTask:(...args)=>findPendingTask(...args),
        mergeGeneratedOutputs:(...args)=>mergeGeneratedOutputs(...args),
        get CANVAS_MEDIA_OUTPUT_TYPES(){return CANVAS_MEDIA_OUTPUT_TYPES;},
        get activeCanvasComfyTaskPolls(){return activeCanvasComfyTaskPolls;},
        get activeCanvasTaskPolls(){return activeCanvasTaskPolls;},
        get canvas(){return canvas;},
        get connections(){return connections;},
        get nodes(){return nodes;},
        actionFailed:(...args)=>actionFailed(...args),
        addGenerationLog:(...args)=>addGenerationLog(...args),
        cascadeBackendRestartMessage:(...args)=>cascadeBackendRestartMessage(...args),
        cascadeFetch:(...args)=>cascadeFetch(...args),
        ensureCascadeActive:(...args)=>ensureCascadeActive(...args),
        extractUpstreamTaskId:(...args)=>extractUpstreamTaskId(...args),
        fetch:(...args)=>fetch(...args),
        isCascadeAbortError:(...args)=>isCascadeAbortError(...args),
        isVideoUrl:(...args)=>isVideoUrl(...args),
        latestGeneratedOutputItem:(...args)=>latestGeneratedOutputItem(...args),
        materializeCanvasDirectTasks:(...args)=>materializeCanvasDirectTasks(...args),
        mediaKindForOutputItem:(...args)=>mediaKindForOutputItem(...args),
        noReturnedImage:(...args)=>noReturnedImage(...args),
        normalizeCanvasTaskError:(...args)=>normalizeCanvasTaskError(...args),
        nowMs:(...args)=>nowMs(...args),
        outputNodesForSource:(...args)=>outputNodesForSource(...args),
        outputUrlValue:(...args)=>outputUrlValue(...args),
        providerIdForPending:(...args)=>providerIdForPending(...args),
        refreshGeneratorInputViews:(...args)=>refreshGeneratorInputViews(...args),
        refreshRunNodes:(...args)=>refreshRunNodes(...args),
        requestMetaFromResult:(...args)=>requestMetaFromResult(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        resultMediaUrls:(...args)=>resultMediaUrls(...args),
        resumeCanvasDepthCaptureTasks:(...args)=>resumeCanvasDepthCaptureTasks(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        sleep:(...args)=>sleep(...args),
        syncGeneratorInputs:(...args)=>syncGeneratorInputs(...args),
        tr:(...args)=>tr(...args),
        validateCanvasAssistantCatalogTask:(...args)=>validateCanvasAssistantCatalogTask(...args),
        waitCanvasComfyTaskResult:(...args)=>waitCanvasComfyTaskResult(...args),
        waitCanvasVideoTaskResult:(...args)=>waitCanvasVideoTaskResult(...args)
    };
}
function outputHasUrl(out, url){
    return CanvasTaskResults.outputHasUrl(classicTaskRuntimeHost(), out, url);
}
function appendOutputImagesWithoutDuplicates(out, images, compareRef=null, metas=[], layout=null){
    return CanvasTaskResults.appendOutputImagesWithoutDuplicates(classicTaskRuntimeHost(), out, images, compareRef, metas, layout);
}
function syncLatestGeneratedOutputToConnection(fromId, toId){
    return CanvasTaskResults.syncLatestGeneratedOutputToConnection(classicTaskRuntimeHost(), fromId, toId);
}
function syncConnectedOutputsFromGenerated(node, outputs){
    return CanvasTaskResults.syncConnectedOutputsFromGenerated(classicTaskRuntimeHost(), node, outputs);
}
function classicGeneratorInputHost(){
    return {
        get CANVAS_GENERATOR_TYPES(){return CANVAS_GENERATOR_TYPES;},
        get CANVAS_MEDIA_OUTPUT_TYPES(){return CANVAS_MEDIA_OUTPUT_TYPES;},
        get connections(){return connections;},
        get generatorInputSyncTimer(){return generatorInputSyncTimer;},
        set generatorInputSyncTimer(value){generatorInputSyncTimer=value;},
        get loopContext(){return loopContext;},
        get nodes(){return nodes;},
        get nodesEl(){return nodesEl;},
        canvasApiAudioMode:(...args)=>canvasApiAudioMode(...args),
        clearTimeout:(...args)=>clearTimeout(...args),
        imageRefsOnly:(...args)=>imageRefsOnly(...args),
        loopCount:(...args)=>loopCount(...args),
        loopInputImageRefs:(...args)=>loopInputImageRefs(...args),
        mediaKindForNode:(...args)=>mediaKindForNode(...args),
        mediaKindForOutputItem:(...args)=>mediaKindForOutputItem(...args),
        mediaKindForRef:(...args)=>mediaKindForRef(...args),
        outputImageName:(...args)=>outputImageName(...args),
        outputUrlValue:(...args)=>outputUrlValue(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        render:(...args)=>render(...args),
        renderComfyImages:(...args)=>renderComfyImages(...args),
        renderImageInputList:(...args)=>renderImageInputList(...args),
        renderLoopPrompt:(...args)=>renderLoopPrompt(...args),
        renderPromptPreview:(...args)=>renderPromptPreview(...args),
        renderRhInputs:(...args)=>renderRhInputs(...args),
        renderRhParams:(...args)=>renderRhParams(...args),
        renderRhPromptFields:(...args)=>renderRhPromptFields(...args),
        renderVideoImageInputs:(...args)=>renderVideoImageInputs(...args),
        rhActiveFields:(...args)=>rhActiveFields(...args),
        rhCurrentKind:(...args)=>rhCurrentKind(...args),
        rhMediaSources:(...args)=>rhMediaSources(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setTimeout:(...args)=>setTimeout(...args),
        tr:(...args)=>tr(...args),
        trf:(...args)=>trf(...args)
    };
}
function generatedImageRefs(node){
    return CanvasGeneratorInput.generatedImageRefs(classicGeneratorInputHost(), node);
}
function mediaRefsFromNode(node){
    return CanvasGeneratorInput.mediaRefsFromNode(classicGeneratorInputHost(), node);
}
function generatorSources(gen){
    return CanvasGeneratorInput.generatorSources(classicGeneratorInputHost(), gen);
}
function orderedSources(gen, sources){
    return CanvasGeneratorInput.orderedSources(classicGeneratorInputHost(), gen, sources);
}
function reorderInput(gen, movedId, targetId){
    return CanvasGeneratorInput.reorderInput(classicGeneratorInputHost(), gen, movedId, targetId);
}
function syncGeneratorInputs(){
    return CanvasGeneratorInput.syncGeneratorInputs(classicGeneratorInputHost());
}
// 提示词节点每敲一个字都全量重建所有生成器节点的输入/预览 DOM 会卡顿。节点的 text 已即时写入
// （运行时实时读取，不受影响），生成器里的预览只需稍后同步一次即可，这里做防抖。
let generatorInputSyncTimer = 0;
function scheduleGeneratorInputSync(){
    return CanvasGeneratorInput.scheduleGeneratorInputSync(classicGeneratorInputHost());
}
function refreshGeneratorInputViews(){
    return CanvasGeneratorInput.refreshGeneratorInputViews(classicGeneratorInputHost());
}
function classicGenerationHost(){
    return {
        get CANVAS_REFERENCE_IMAGE_MAX(){return CANVAS_REFERENCE_IMAGE_MAX;},
        get CLIENT_ID(){return CLIENT_ID;},
        get CanvasVideoDeconstructionModel(){return CanvasVideoDeconstructionModel;},
        get activeCanvasComfyTaskPolls(){return activeCanvasComfyTaskPolls;},
        get apiProviders(){return apiProviders;},
        get canvas(){return canvas;},
        get comfyWorkflows(){return comfyWorkflows;},
        get connections(){return connections;},
        get nodes(){return nodes;},
        actionFailed:(...args)=>actionFailed(...args),
        addGenerationLog:(...args)=>addGenerationLog(...args),
        alert:(...args)=>alert(...args),
        appendOutputImages:(...args)=>appendOutputImages(...args),
        applyUploadedUrlToRefs:(...args)=>applyUploadedUrlToRefs(...args),
        audioRefsOnly:(...args)=>audioRefsOnly(...args),
        canvasApiAudioMode:(...args)=>canvasApiAudioMode(...args),
        canvasVideoTaskIdForPending:(...args)=>canvasVideoTaskIdForPending(...args),
        cascadeAbortError:(...args)=>cascadeAbortError(...args),
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeStopMessage:(...args)=>cascadeStopMessage(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        collectRunMeta:(...args)=>collectRunMeta(...args),
        collectRunMetas:(...args)=>collectRunMetas(...args),
        comfyFieldKind:(...args)=>comfyFieldKind(...args),
        comfyFields:(...args)=>comfyFields(...args),
        comfyNameForRef:(...args)=>comfyNameForRef(...args),
        comfyParamValue:(...args)=>comfyParamValue(...args),
        comfyRandomActive:(...args)=>comfyRandomActive(...args),
        comfyRandomEnabled:(...args)=>comfyRandomEnabled(...args),
        comfyRandomValue:(...args)=>comfyRandomValue(...args),
        comfyResultOutputs:(...args)=>comfyResultOutputs(...args),
        comfyRunLabel:(...args)=>comfyRunLabel(...args),
        completeCanvasImageTask:(...args)=>completeCanvasImageTask(...args),
        completeCanvasVideoTask:(...args)=>completeCanvasVideoTask(...args),
        confirmCanvasUnknownResubmission:(...args)=>confirmCanvasUnknownResubmission(...args),
        createCanvasComfyTask:(...args)=>createCanvasComfyTask(...args),
        createCanvasVideoTask:(...args)=>createCanvasVideoTask(...args),
        ensureCascadeActive:(...args)=>ensureCascadeActive(...args),
        ensureComfyWorkflow:(...args)=>ensureComfyWorkflow(...args),
        extractUpstreamTaskId:(...args)=>extractUpstreamTaskId(...args),
        failCanvasImageTask:(...args)=>failCanvasImageTask(...args),
        findPendingTask:(...args)=>findPendingTask(...args),
        generatorSizeForRun:(...args)=>generatorSizeForRun(...args),
        generatorSources:(...args)=>generatorSources(...args),
        imageRefsOnly:(...args)=>imageRefsOnly(...args),
        isCascadeAbortError:(...args)=>isCascadeAbortError(...args),
        langIsEn:(...args)=>langIsEn(...args),
        llmInputAudios:(...args)=>llmInputAudios(...args),
        llmInputImages:(...args)=>llmInputImages(...args),
        llmInputText:(...args)=>llmInputText(...args),
        llmInputVideos:(...args)=>llmInputVideos(...args),
        makePendingForRun:(...args)=>makePendingForRun(...args),
        manualVideoUrlForNode:(...args)=>manualVideoUrlForNode(...args),
        mediaKindForRef:(...args)=>mediaKindForRef(...args),
        mergeGeneratedOutputs:(...args)=>mergeGeneratedOutputs(...args),
        noReturnedImage:(...args)=>noReturnedImage(...args),
        normalizedImageQuality:(...args)=>normalizedImageQuality(...args),
        nowMs:(...args)=>nowMs(...args),
        orderedSources:(...args)=>orderedSources(...args),
        outputForNode:(...args)=>outputForNode(...args),
        outputNodesForSource:(...args)=>outputNodesForSource(...args),
        pauseCanvasAcceptedTasksUntilSaved:(...args)=>pauseCanvasAcceptedTasksUntilSaved(...args),
        pendingById:(...args)=>pendingById(...args),
        pollCanvasImageTask:(...args)=>pollCanvasImageTask(...args),
        providerChatModels:(...args)=>providerChatModels(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        refreshRunNodes:(...args)=>refreshRunNodes(...args),
        rememberCanvasSubmissionWarning:(...args)=>rememberCanvasSubmissionWarning(...args),
        rememberUnsavedCanvasAcceptedTasks:(...args)=>rememberUnsavedCanvasAcceptedTasks(...args),
        render:(...args)=>render(...args),
        requestMetaFromResult:(...args)=>requestMetaFromResult(...args),
        resolveChatModel:(...args)=>resolveChatModel(...args),
        resolveChatProviderId:(...args)=>resolveChatProviderId(...args),
        resolveImageModel:(...args)=>resolveImageModel(...args),
        resolveImageProviderId:(...args)=>resolveImageProviderId(...args),
        resolveMidjourneyProviderId:(...args)=>resolveMidjourneyProviderId(...args),
        resolveVideoProviderId:(...args)=>resolveVideoProviderId(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        runAudioAnalysisGenerator:(...args)=>runAudioAnalysisGenerator(...args),
        runCanvasApiAudio:(...args)=>runCanvasApiAudio(...args),
        runCanvasAssistantCatalogImage:(...args)=>runCanvasAssistantCatalogImage(...args),
        runQueuedComfyGenerate:(...args)=>runQueuedComfyGenerate(...args),
        runSnapshot:(...args)=>runSnapshot(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        scheduleGeneratorInputSync:(...args)=>scheduleGeneratorInputSync(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setTimeout:(...args)=>setTimeout(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        sleep:(...args)=>sleep(...args),
        submitCanvasImageTaskBatch:(...args)=>submitCanvasImageTaskBatch(...args),
        tempShUploadedUrlForNode:(...args)=>tempShUploadedUrlForNode(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args),
        uploadCanvasUrlToComfy:(...args)=>uploadCanvasUrlToComfy(...args),
        validComfyWorkflowName:(...args)=>validComfyWorkflowName(...args),
        videoRefsOnly:(...args)=>videoRefsOnly(...args),
        waitCanvasComfyTaskResult:(...args)=>waitCanvasComfyTaskResult(...args),
        waitCanvasDirectTasks:(...args)=>waitCanvasDirectTasks(...args),
        waitCanvasImageTaskResult:(...args)=>waitCanvasImageTaskResult(...args),
        waitCanvasVideoTaskResult:(...args)=>waitCanvasVideoTaskResult(...args)
    };
}
async function runGenerator(genId, opts={}){
    return CanvasMediaRunner.runGenerator(classicGenerationHost(), genId, opts);
}
async function midjourneyRequest(path, options={}){
    return CanvasMidjourneyRunner.midjourneyRequest(classicGenerationHost(), path, options);
}
async function waitMidjourneyTask(providerId, taskId, options={}){
    return CanvasMidjourneyRunner.waitMidjourneyTask(classicGenerationHost(), providerId, taskId, options);
}
async function completeMidjourneyRun(node, out, run, result, append=false){
    return CanvasMidjourneyRunner.completeMidjourneyRun(classicGenerationHost(), node, out, run, result, append);
}
async function runMidjourneyNode(nodeId, opts={}){
    return CanvasMidjourneyRunner.runMidjourneyNode(classicGenerationHost(), nodeId, opts);
}
async function runMidjourneyAction(nodeId, action, index=0, extra={}){
    return CanvasMidjourneyRunner.runMidjourneyAction(classicGenerationHost(), nodeId, action, index, extra);
}
async function runMidjourneyModal(nodeId, maskRef){
    return CanvasMidjourneyRunner.runMidjourneyModal(classicGenerationHost(), nodeId, maskRef);
}
function canvasVideoTaskIdForPending(pending){
    if(!pending) return '';
    if(!pending.canvasTaskId){
        pending.canvasTaskId = `canvas_video_${uid('v').replace(/[^A-Za-z0-9_-]/g, '')}`;
    }
    pending.canvasTaskType = 'video';
    pending.queryRecoverable = true;
    return pending.canvasTaskId;
}
async function createCanvasVideoTask(payload, pending, options={}){
    return CanvasTaskTransport.createCanvasVideoTask({
        canvasVideoTaskIdForPending:(...args)=>canvasVideoTaskIdForPending(...args),
        fetch:(...args)=>fetch(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args)
    }, payload, pending, options);
}
async function refreshCanvasImageTaskOnce(taskId, options={}){
    return CanvasTaskTransport.refreshCanvasImageTaskOnce({
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args)
    }, taskId, options);
}
async function refreshCanvasImagePending(pending){
    if(!pending?.canvasTaskId || pending.querying) return;
    const found = findPendingTask(pending.canvasTaskId);
    if(!found || found.pending !== pending) return;
    pending.querying = true;
    refreshRunNodes(nodes.find(n => n.id === pending.run?.node?.id), found.out);
    try {
        const data = await refreshCanvasImageTaskOnce(pending.canvasTaskId, {cascadeTargetId:pending.cascadeTargetId});
        if(data.status === 'succeeded'){
            completeCanvasImageTask(pending.canvasTaskId, data.result || {});
            return;
        }
        if(data.status === 'failed'){
            failCanvasImageTask(pending.canvasTaskId, data.error || tr('canvas.generationFailed'), data);
            return;
        }
        pending.error = data.error || data.message || '远端任务仍在生成中，请稍后再次刷新';
        pending.taskLost = true;
        pending.failed = true;
        pending.remoteRefreshable = Boolean(data.upstream_task_id);
    } catch(error){
        pending.error = error.message || '图片任务刷新失败';
        pending.taskLost = true;
        pending.failed = true;
        pending.remoteRefreshable = !error.imageTaskRefreshUnavailable;
    } finally {
        const latest = pendingById(found.out, pending.id);
        if(latest){
            latest.querying = false;
            refreshRunNodes(nodes.find(n => n.id === latest.run?.node?.id), found.out);
            scheduleSave();
        }
    }
}
async function refreshCanvasVideoTaskOnce(taskId, options={}){
    return CanvasTaskTransport.refreshCanvasVideoTaskOnce({
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args)
    }, taskId, options);
}
async function waitCanvasVideoTaskResult(taskId, options={}){
    return CanvasTaskTransport.waitCanvasVideoTaskResult({
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        ensureCascadeActive:(...args)=>ensureCascadeActive(...args),
        findPendingTask:(...args)=>findPendingTask(...args),
        isCascadeAbortError:(...args)=>isCascadeAbortError(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        sleep:(...args)=>sleep(...args)
    }, taskId, options);
}
function completeCanvasVideoTask(taskId, result, fallback=null){
    return CanvasTaskResults.completeCanvasVideoTask(classicTaskRuntimeHost(), taskId, result, fallback);
}
async function pollCanvasVideoTask(taskId, options={}){
    return CanvasTaskRuntime.pollCanvasVideoTask(classicTaskRuntimeHost(), taskId, options);
}
async function runVideoNode(nodeId, opts={}){
    return CanvasMediaRunner.runVideoNode(classicGenerationHost(), nodeId, opts);
}










async function uploadCanvasUrlToComfy(url){
    const blob = await fetch(url).then(r => {
        if(!r.ok) throw new Error(langIsEn() ? 'Image read failed' : '图片读取失败');
        return r.blob();
    });
    const filename = (url || '').split('/').pop()?.split('?')[0] || `canvas_${Date.now()}.png`;
    const form = new FormData();
    form.append('files', blob, filename);
    const data = await fetch('/api/upload', {method:'POST', body:form}).then(async r => {
        if(!r.ok) throw new Error(await responseErrorMessage(r, langIsEn() ? 'Image upload to ComfyUI failed' : '图片上传到 ComfyUI 失败'));
        return r.json();
    });
    const comfyName = String(data.files?.[0]?.comfy_name || '').trim();
    if(!comfyName) throw new Error(langIsEn() ? 'ComfyUI upload failed' : 'ComfyUI 上传失败');
    return comfyName;
}
async function comfyNameForRef(ref){
    if(ref.comfy_name) return ref.comfy_name;
    if(!ref.url) throw new Error(langIsEn() ? 'Missing input image' : '缺少输入图片');
    return uploadCanvasUrlToComfy(ref.url);
}
async function runComfyUpscale(imageUrl, resolution, options={}){
    return CanvasComfyRunner.runComfyUpscale(classicGenerationHost(), imageUrl, resolution, options);
}
function comfyResultOutputs(result){
    return resultMediaUrls(result);
}
function resultMediaUrls(result){
    const urls = [];
    const add = value => {
        if(!value) return;
        if(typeof value === 'string'){
            urls.push(value);
            return;
        }
        if(Array.isArray(value)){
            value.forEach(add);
            return;
        }
        if(typeof value === 'object'){
            if(value.url || value.path || value.src || value.uri){
                const url = value.url || value.path || value.src || value.uri;
                if(url) urls.push({url, kind:value.kind || value.type || value.mediaKind || '', name:value.name || value.filename || ''});
            }
            ['outputs','videos','images','urls','data','result'].forEach(key => add(value[key]));
            ['url','path','src','uri','output','output_url','outputUrl','video','video_url','videoUrl','mp4_url','mp4Url','download_url','downloadUrl','preview_url','previewUrl'].forEach(key => add(value[key]));
        }
    };
    ['items','outputs','videos','audios','texts','files','images','urls','data','result','output','url'].forEach(key => add(result?.[key]));
    const seen = new Set();
    return urls.map(item => {
        const url = outputUrlValue(item);
        if(!url) return null;
        return typeof item === 'object' ? item : url;
    }).filter(item => {
        const url = outputUrlValue(item);
        return url && !seen.has(url) && seen.add(url);
    });
}











function classicCascadeHost(){
    return {
        get cascadeContexts(){return cascadeContexts;},
        get cascadeRunningIds(){return cascadeRunningIds;},
        get cascadeSerialIds(){return cascadeSerialIds;},
        get cascadeStopIds(){return cascadeStopIds;},
        get comfyBackendCount(){return comfyBackendCount;},
        get loopContext(){return loopContext;},
        set loopContext(value){loopContext=value;},
        get nodes(){return nodes;},
        alert:(...args)=>alert(...args),
        beginCascade:(...args)=>beginCascade(...args),
        cascadeAbortError:(...args)=>cascadeAbortError(...args),
        cascadeContextFor:(...args)=>cascadeContextFor(...args),
        cascadeContextFromOptions:(...args)=>cascadeContextFromOptions(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        cascadeUiNodeIds:(...args)=>cascadeUiNodeIds(...args),
        clearTimeout:(...args)=>clearTimeout(...args),
        computeCascadeOrder:(...args)=>computeCascadeOrder(...args),
        confirmOrphanUnknownCanvasSubmission:(...args)=>confirmOrphanUnknownCanvasSubmission(...args),
        ensureCascadeActive:(...args)=>ensureCascadeActive(...args),
        fetch:(...args)=>fetch(...args),
        finalizeCascade:(...args)=>finalizeCascade(...args),
        isCascadeAbortError:(...args)=>isCascadeAbortError(...args),
        isCascadeActive:(...args)=>isCascadeActive(...args),
        langIsEn:(...args)=>langIsEn(...args),
        nowMs:(...args)=>nowMs(...args),
        refreshNodes:(...args)=>refreshNodes(...args),
        resolveCascadeLoop:(...args)=>resolveCascadeLoop(...args),
        runComfyNode:(...args)=>runComfyNode(...args),
        runGenerator:(...args)=>runGenerator(...args),
        runLLMNode:(...args)=>runLLMNode(...args),
        runMidjourneyNode:(...args)=>runMidjourneyNode(...args),
        runMsGenNode:(...args)=>runMsGenNode(...args),
        runRhNode:(...args)=>runRhNode(...args),
        runVideoNode:(...args)=>runVideoNode(...args),
        setTimeout:(...args)=>setTimeout(...args),
        tr:(...args)=>tr(...args)
    };
}
function clearStuckGeneratorRunning(node){
    return CanvasCascadeState.clearStuckGeneratorRunning(classicCascadeHost(), node);
}
function resetCascadeRuntimeState(){
    return CanvasCascadeState.resetCascadeRuntimeState(classicCascadeHost());
}
function cascadeContextFor(targetId){
    return CanvasCascadeState.cascadeContextFor(classicCascadeHost(), targetId);
}
function isCascadeActive(targetId){
    return CanvasCascadeState.isCascadeActive(classicCascadeHost(), targetId);
}
function isCascadeStopping(targetId){
    return CanvasCascadeState.isCascadeStopping(classicCascadeHost(), targetId);
}
function cascadeAbortError(message='已停止一键运行'){
    return CanvasCascadeState.cascadeAbortError(classicCascadeHost(), message);
}
function isCascadeAbortError(err){
    return CanvasCascadeState.isCascadeAbortError(classicCascadeHost(), err);
}
function cascadeStopMessage(reason=''){
    return CanvasCascadeState.cascadeStopMessage(classicCascadeHost(), reason);
}
function cascadeBackendRestartMessage(){
    return CanvasCascadeState.cascadeBackendRestartMessage(classicCascadeHost());
}
function normalizeCanvasTaskError(err, fallback=''){
    return CanvasTaskErrorRules.normalizeErrorMessage(err, {
        fallback:fallback || tr('canvas.generationFailed'),
        restartMessage:cascadeBackendRestartMessage()
    });
}
function clearCascadeNodeState(node, options={}){
    return CanvasCascadeState.clearCascadeNodeState(classicCascadeHost(), node, options);
}
function createCascadeContext(targetId, order, options={}){
    return CanvasCascadeState.createCascadeContext(classicCascadeHost(), targetId, order, options);
}
function clearCascadeCleanupTimer(ctx){
    return CanvasCascadeState.clearCascadeCleanupTimer(classicCascadeHost(), ctx);
}
function beginCascade(targetId, order, options={}){
    return CanvasCascadeState.beginCascade(classicCascadeHost(), targetId, order, options);
}
function queueCascadeCleanup(ctx, ids){
    return CanvasCascadeState.queueCascadeCleanup(classicCascadeHost(), ctx, ids);
}
function requestCascadeStop(targetId, reason=''){
    return CanvasCascadeState.requestCascadeStop(classicCascadeHost(), targetId, reason);
}
function ensureCascadeActive(targetId, reason=''){
    return CanvasCascadeState.ensureCascadeActive(classicCascadeHost(), targetId, reason);
}
function finalizeCascade(targetId, state, options={}){
    return CanvasCascadeState.finalizeCascade(classicCascadeHost(), targetId, state, options);
}
function cascadeTargetIdFromOptions(options={}){
    return CanvasCascadeState.cascadeTargetIdFromOptions(classicCascadeHost(), options);
}
function cascadeContextFromOptions(options={}){
    return CanvasCascadeState.cascadeContextFromOptions(classicCascadeHost(), options);
}
async function cascadeFetch(input, init={}, options={}){
    return CanvasCascadeState.cascadeFetch(classicCascadeHost(), input, init, options);
}



async function runComfyNode(nodeId, opts={}){
    return CanvasComfyRunner.runComfyNode(classicGenerationHost(), nodeId, opts);
}
async function callCanvasLLM(node, message, messages=[], options={}){
    return CanvasLLMRunner.callCanvasLLM(classicGenerationHost(), node, message, messages, options);
}
async function runAudioAnalysisGenerator(node, prompt, audios, opts={}){
    return CanvasLLMRunner.runAudioAnalysisGenerator(classicGenerationHost(), node, prompt, audios, opts);
}
async function runLLMNode(nodeId, opts={}){
    return CanvasLLMRunner.runLLMNode(classicGenerationHost(), nodeId, opts);
}
// 判断是不是「链尾」节点：没有下游生成节点（直接相连或经 Output 中转都算）
function isTerminalGenerator(nodeId){
    const GEN_TYPES = canvasRunTypes();
    for(const c of connections.filter(c => c.from === nodeId)){
        const t = nodes.find(n => n.id === c.to);
        if(!t) continue;
        if(GEN_TYPES.includes(t.type)) return false;
        if(t.type === 'output'){
            for(const c2 of connections.filter(cc => cc.from === t.id)){
                const t2 = nodes.find(n => n.id === c2.to);
                if(t2 && GEN_TYPES.includes(t2.type)) return false;
            }
        }
    }
    return true;
}
function findLoopCascadeTarget(loopId){
    const runTypes = canvasRunTypes();
    const seen = new Set();
    const candidates = [];
    const walk = (id, depth=0) => {
        if(seen.has(id)) return;
        seen.add(id);
        connections.filter(c => c.from === id).forEach(c => {
            const next = nodes.find(n => n.id === c.to);
            if(!next) return;
            if(runTypes.includes(next.type)){
                candidates.push({id:next.id, depth:depth + 1, terminal:isTerminalGenerator(next.id)});
            }
            walk(next.id, depth + 1);
        });
    };
    walk(loopId);
    const terminal = candidates.filter(c => c.terminal).sort((a, b) => b.depth - a.depth)[0];
    return (terminal || candidates.sort((a, b) => b.depth - a.depth)[0])?.id || '';
}
function cascadeBtnHtml(node){
    // 仅链尾节点显示一键运行
    if(!isTerminalGenerator(node.id)) return '';
    // 也要求至少有上游生成节点，否则没意义
    const order = computeCascadeOrder(node.id);
    const loop = resolveCascadeLoop(node.id);
    if(order.length <= 1 && !loop) return '';
    const suffix = loop ? ` × ${loop.count} ${tr('canvas.loopRounds')}` : '';
    if(isCascadeActive(node.id)){
        const stopping = isCascadeStopping(node.id);
        return `<button class="gen-cascade-btn gen-cascade-stop" type="button" data-cascade-stop="${node.id}" ${stopping ? 'disabled' : ''}><i data-lucide="square" class="w-4 h-4"></i><span>${stopping ? '停止中…' : '停止运行'}</span></button>`;
    }
    return `<button class="gen-cascade-btn" type="button" data-cascade="${node.id}" title="一键运行整条工作流（追溯所有上游生成节点）"><i data-lucide="play-circle" class="w-4 h-4"></i><span>一键运行 ${order.length} 个节点${suffix}</span></button>`;
}
function retryBarHtml(node){
    // 只在一键运行模式中失败才显示；普通单节点失败直接弹 alert，不显示这条
    if(node.runStatus !== 'failed' || !node._cascadeFailed) return '';
    return `<div class="node-retry-bar" data-retry-bar>
        <span class="node-retry-msg" title="${escapeAttr(node.runError||'')}">${escapeHtml((node.runError||tr('canvas.generationFailed')).slice(0,60))}</span>
        <button class="node-retry-btn" type="button" data-retry="${node.id}">重试</button>
        <button class="node-stop-btn" type="button" data-stop="${node.id}">停止</button>
    </div>`;
}
function bindCascadeButtons(wrap, nodeId){
    wrap.querySelectorAll(`[data-cascade="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); runNodeCascade(nodeId); };
    });
    wrap.querySelectorAll(`[data-cascade-stop="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); requestCascadeStop(nodeId); };
    });
    wrap.querySelectorAll(`[data-retry="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); retryNodeAndDownstream(nodeId); };
    });
    wrap.querySelectorAll(`[data-stop="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); cancelCascade(nodeId); };
    });
}
// —— 一键运行：从目标节点反向追溯到所有上游生成节点，按拓扑顺序串行执行 ——
function runCascadeNodeByType(node, opts={}){
    return CanvasCascadeRunner.runCascadeNodeByType(classicCascadeHost(), node, opts);
}
async function runCascadeNodeWithLoopContext(node, ctx, opts={}){
    return CanvasCascadeRunner.runCascadeNodeWithLoopContext(classicCascadeHost(), node, ctx, opts);
}
function cascadeParallelLimit(order, totalRounds){
    return CanvasCascadeRunner.cascadeParallelLimit(classicCascadeHost(), order, totalRounds);
}
async function runLimitedCascadeRounds(rounds, limit, runner){
    return CanvasCascadeRunner.runLimitedCascadeRounds(classicCascadeHost(), rounds, limit, runner);
}
function classicGraphHost(){
    return {
        get CANVAS_GENERATOR_TYPES(){return CANVAS_GENERATOR_TYPES;},
        get CANVAS_MEDIA_OUTPUT_TYPES(){return CANVAS_MEDIA_OUTPUT_TYPES;},
        get connections(){return connections;},
        get nodes(){return nodes;},
        canvasApiAudioMode:(...args)=>canvasApiAudioMode(...args),
        loopCount:(...args)=>loopCount(...args)
    };
}
function canvasRunTypes(){
    return CanvasGraphRules.canvasRunTypes(classicGraphHost());
}
function canvasWorkflowEdges(){
    return CanvasGraphRules.canvasWorkflowEdges(classicGraphHost());
}
function computeConnectedWorkflowOrder(anchorId){
    return CanvasGraphRules.computeConnectedWorkflowOrder(classicGraphHost(), anchorId);
}
async function runCanvasGenerate(nodeId){
    return CanvasCascadeRunner.runCanvasGenerate(classicCascadeHost(), nodeId);
}
function computeCascadeOrder(targetId){
    return CanvasGraphRules.computeCascadeOrder(classicGraphHost(), targetId);
}
function upstreamNodeIds(targetId){
    return CanvasGraphRules.upstreamNodeIds(classicGraphHost(), targetId);
}
function resolveCascadeLoop(targetId){
    return CanvasGraphRules.resolveCascadeLoop(classicGraphHost(), targetId);
}
function cascadeUiNodeIds(targetId, order=null){
    return CanvasCascadeState.cascadeUiNodeIds(classicCascadeHost(), targetId, order);
}
async function runNodeCascade(nodeId){
    return CanvasCascadeRunner.runNodeCascade(classicCascadeHost(), nodeId);
}
async function runOneCascadePass(order, options={}){
    return CanvasCascadeRunner.runOneCascadePass(classicCascadeHost(), order, options);
}
// 失败重试：从该节点继续往下游跑
async function retryNodeAndDownstream(nodeId){
    return CanvasCascadeRunner.retryNodeAndDownstream(classicCascadeHost(), nodeId);
}
function cancelCascade(nodeId){
    return CanvasCascadeState.cancelCascade(classicCascadeHost(), nodeId);
}

async function runLLMChat(nodeId){
    return CanvasLLMRunner.runLLMChat(classicGenerationHost(), nodeId);
}

function deleteNode(id, event){
    return CanvasNodeEdit.deleteNode(classicNodeEditHost(), id, event);
}
function clearNodeContentBeforeDelete(id){
    return CanvasNodeEdit.clearNodeContentBeforeDelete(classicNodeEditHost(), id);
}
function deleteNodeFromButton(id, event){
    return CanvasNodeEdit.deleteNodeFromButton(classicNodeEditHost(), id, event);
}
function deleteConnection(id, event){
    return CanvasNodeEdit.deleteConnection(classicNodeEditHost(), id, event);
}
function outputDownloadName(url){
    const clean = (url || '').split('?')[0];
    const ext = clean.includes('.') ? clean.split('.').pop() : 'png';
    return `canvas-output-${Date.now()}.${ext || 'png'}`;
}
function isVideoUrl(url){
    const clean = canvasOriginalMediaUrl(url).split('?')[0].toLowerCase();
    return /\.(mp4|webm|mov|m4v|avi|mkv|flv)$/.test(clean);
}
function mediaKindForOutputItem(item){
    const explicit = String(item?.kind || item?.mediaKind || '').toLowerCase();
    if(['image','video','audio','text','file'].includes(explicit)) return explicit;
    const url = outputUrlValue(item);
    if(isVideoUrl(url)) return 'video';
    if(isAudioUrl(url)) return 'audio';
    if(isTextUrl(url)) return 'text';
    return 'image';
}
function formatRunDuration(ms){
    const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
function nowMs(){ return Date.now(); }
function outputUrlValue(item){
    return typeof item === 'string' ? item : item?.url || '';
}
function isMissingAssetUrl(url){
    return Boolean(url && missingAssetUrls.has(url));
}
function missingAssetHtml(url, compact=false){
    return `<div class="missing-asset ${compact ? 'compact' : ''}" title="${escapeAttr(url || '')}"><i data-lucide="image-off" class="${compact ? 'w-4 h-4' : 'w-6 h-6'}"></i><span>${langIsEn() ? 'Missing file' : '文件缺失'}</span></div>`;
}
function outputMetaFor(url, out){
    const item = (out?.images || []).find(x => outputUrlValue(x) === url);
    return item && typeof item === 'object' ? item : {};
}
function runSnapshot(node, prompt, refs=[]){
    const clone = JSON.parse(JSON.stringify(node || {}));
    delete clone.running;
    delete clone.runStatus;
    delete clone.runError;
    delete clone.inputs;
    return {
        nodeType: node?.type || '',
        node: clone,
        prompt: prompt || '',
        refs: (refs || []).map(ref => ({url:ref.url, name:ref.name || 'image'})).filter(ref => ref.url),
    };
}
function comfyRunLabel(node){
    const mode = node?.mode || 'text';
    if(mode === 'text') return tr('canvas.comfyText');
    if(mode === 'enhance') return tr('canvas.comfyEnhance');
    if(mode === 'edit') return tr('canvas.comfyEdit');
    if(mode === 'custom') return node?.comfyWorkflow || tr('canvas.comfyCustom');
    return 'ComfyUI';
}
function runTaskLabel(run){
    const node = run?.node || {};
    if(run?.taskLabel) return run.taskLabel;
    if(run?.nodeType === 'comfy') return comfyRunLabel(node);

    if(run?.nodeType === 'generator') return node.model || 'API Image';
    if(run?.nodeType === 'video') return node.model || 'Video';
    if(run?.nodeType === 'msgen') return node.msCustomModel || node.msgenModel || 'Modelscope';
    return run?.nodeType || 'Generate';
}
function requestMetaFromResult(result={}){
    return {
        task_id: result.task_id || result.raw?.task_id || result.raw?.data?.task_id || (Array.isArray(result.raw?.data) ? result.raw.data[0]?.task_id : '') || '',
        request_id: result.request_id || result.id || result.raw?.id || '',
        provider_id: result.provider_id || result.params?.provider_id || '',
        backend: result.backend || '',
        prompt_id: result.prompt_id || '',
        workflow_json: result.workflow_json || '',
        seed: result.seed || '',
    };
}
function runPlatformLabel(run){
    const node = run?.node || {};
    if(run?.nodeType === 'generator') return providerById(node.apiProvider || 'comfly')?.name || node.apiProvider || 'API';
    if(run?.nodeType === 'msgen') return 'Modelscope';
    if(run?.nodeType === 'video') return providerById(node.apiProvider || 'comfly')?.name || node.apiProvider || 'Video';
    if(run?.nodeType === 'comfy') return 'ComfyUI';

    return run?.nodeType || 'Generate';
}
function comfyLabelFromWorkflow(workflow){
    const name = String(workflow || '').toLowerCase();
    if(!name) return '';
    if(name === 'z-image.json') return tr('canvas.comfyText');
    if(name === 'z-image-enhance.json' || name === 'upscale.json') return tr('canvas.comfyEnhance');
    if(name === 'flux2-klein.json') return tr('canvas.comfyEdit');
    return workflow;
}
function classicLogHost(){
    return {
        get canvas(){return typeof canvas==='undefined'?undefined:canvas;},
        get classicSaveScheduler(){return classicSaveScheduler;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        get console(){return console;},
        get document(){return document;},
        get lastCanvasUpdatedAt(){return lastCanvasUpdatedAt;},
        set lastCanvasUpdatedAt(value){lastCanvasUpdatedAt=value;},
        get localCanvasDirty(){return localCanvasDirty;},
        get logList(){return typeof logList==='undefined'?undefined:logList;},
        get logModal(){return typeof logModal==='undefined'?undefined:logModal;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get window(){return window;},
        bindCanvasPreviewImageFallbacks:(...args)=>bindCanvasPreviewImageFallbacks(...args),
        canvasPreviewImgHtml:(...args)=>canvasPreviewImgHtml(...args),
        canvasVideoPreviewHtml:(...args)=>canvasVideoPreviewHtml(...args),
        comfyLabelFromWorkflow:(...args)=>comfyLabelFromWorkflow(...args),
        confirm:(...args)=>confirm(...args),
        copyTextToClipboard:(...args)=>copyTextToClipboard(...args),
        escapeAttr:(...args)=>escapeAttr(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        formatRunDuration:(...args)=>formatRunDuration(...args),
        isMissingAssetUrl:(...args)=>isMissingAssetUrl(...args),
        langIsEn:(...args)=>langIsEn(...args),
        mediaKindForOutputItem:(...args)=>mediaKindForOutputItem(...args),
        openOutputLightbox:(...args)=>openOutputLightbox(...args),
        outputUrlValue:(...args)=>outputUrlValue(...args),
        playGenerationCompleteSound:(...args)=>playGenerationCompleteSound(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        render:(...args)=>render(...args),
        runPlatformLabel:(...args)=>runPlatformLabel(...args),
        runTaskLabel:(...args)=>runTaskLabel(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        setStatus:(...args)=>setStatus(...args),
        setTimeout:(...args)=>setTimeout(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function logTaskLabel(log){
    return CanvasLog.logTaskLabel(classicLogHost(), log);
}
async function deleteCanvasLogEntry(logId, deleteMedia=false){
    return CanvasLog.deleteCanvasLogEntry(classicLogHost(), logId, deleteMedia);
}
function addGenerationLog({run, outputs=[], runMs=0, error=''}){
    return CanvasLog.addGenerationLog(classicLogHost(), arguments[0]);
}
function renderCanvasLog(){
    return CanvasLog.renderCanvasLog(classicLogHost());
}
async function importWorkflowAssetUrl(url, name='workflow'){
    return CanvasWorkflowTransfer.importWorkflowAssetUrl(classicWorkflowTransferHost(), url, name);
}
function openCanvasLog(event){
    return CanvasLog.openCanvasLog(classicLogHost(), event);
}
function closeCanvasLog(){
    return CanvasLog.closeCanvasLog(classicLogHost());
}
window.openCanvasLog = openCanvasLog;
window.closeCanvasLog = closeCanvasLog;
function makePending(id, run, task={}){
    return {id, startedAt:nowMs(), run, ...task};
}
function makePendingForRun(id, run, node, options={}, task={}){
    const pending = makePending(id, run, task);
    if(options?.assistantNativeActionId) pending.assistantNativeActionId = String(options.assistantNativeActionId);
    const previewSize = pendingPreviewSizeForRun(node, options);
    if(previewSize) pending.previewSize = previewSize;
    if(options?.cascadeTargetId) pending.cascadeTargetId = String(options.cascadeTargetId);
    return pending;
}
function mergeGeneratedOutputs(node, outputs, append=false){
    return CanvasTaskResults.mergeGeneratedOutputs(classicTaskRuntimeHost(), node, outputs, append);
}
function pendingById(out, id){
    return CanvasTaskResults.pendingById(classicTaskRuntimeHost(), out, id);
}
function collectRunMetas(out, ids){
    return CanvasTaskResults.collectRunMetas(classicTaskRuntimeHost(), out, ids);
}
function collectRunMeta(out, id){
    return CanvasTaskResults.collectRunMeta(classicTaskRuntimeHost(), out, id);
}
function findOutputByPendingId(pendingId){
    return CanvasTaskResults.findOutputByPendingId(classicTaskRuntimeHost(), pendingId);
}
function findPendingTask(taskId){
    return CanvasTaskResults.findPendingTask(classicTaskRuntimeHost(), taskId);
}
function classicAcceptedTaskRecoveryHost(){
    return {
        get CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX(){return CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX;},
        get canvas(){return canvas;},
        get storage(){return typeof localStorage==='undefined'?undefined:localStorage;},
        get CANVAS_UNKNOWN_SUBMISSION_PREFIX(){return CANVAS_UNKNOWN_SUBMISSION_PREFIX;},
        get canvasOrphanUnknownSubmissionCount(){return canvasOrphanUnknownSubmissionCount;},
        set canvasOrphanUnknownSubmissionCount(value){canvasOrphanUnknownSubmissionCount=value;},
        get nodes(){return nodes;},
        scheduleSave:(...args)=>scheduleSave(...args),
        confirm:(...args)=>window.confirm(...args),
        nowMs:(...args)=>nowMs(...args),
        get connections(){return connections;},
        findPendingTask:(...args)=>findPendingTask(...args),
        uid:(...args)=>uid(...args),
        cascadeAbortError:(...args)=>cascadeAbortError(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        tr:(...args)=>tr(...args)
    };
}
function unsavedCanvasAcceptedTasksKey(canvasId=canvas?.id){
    return CanvasAcceptedTaskRecovery.unsavedCanvasAcceptedTasksKey(classicAcceptedTaskRecoveryHost(), canvasId);
}
function readUnsavedCanvasAcceptedTasks(canvasId=canvas?.id){
    return CanvasAcceptedTaskRecovery.readUnsavedCanvasAcceptedTasks(classicAcceptedTaskRecoveryHost(), canvasId);
}
function clearUnsavedCanvasAcceptedTasks(canvasId=canvas?.id, savedNodes=[]){
    return CanvasAcceptedTaskRecovery.clearUnsavedCanvasAcceptedTasks(classicAcceptedTaskRecoveryHost(), canvasId, savedNodes);
}
function unknownCanvasSubmissionKey(canvasId=canvas?.id){
    return CanvasAcceptedTaskRecovery.unknownCanvasSubmissionKey(classicAcceptedTaskRecoveryHost(), canvasId);
}
function clearUnsavedCanvasUnknownWarnings(canvasId=canvas?.id, savedNodes=[]){
    return CanvasAcceptedTaskRecovery.clearUnsavedCanvasUnknownWarnings(classicAcceptedTaskRecoveryHost(), canvasId, savedNodes);
}
function rememberUnsavedCanvasUnknownWarning(node){
    return CanvasAcceptedTaskRecovery.rememberUnsavedCanvasUnknownWarning(classicAcceptedTaskRecoveryHost(), node);
}
function restoreUnsavedCanvasUnknownWarnings(){
    return CanvasAcceptedTaskRecovery.restoreUnsavedCanvasUnknownWarnings(classicAcceptedTaskRecoveryHost());
}
function confirmOrphanUnknownCanvasSubmission(){
    return CanvasAcceptedTaskRecovery.confirmOrphanUnknownCanvasSubmission(classicAcceptedTaskRecoveryHost());
}
function rememberUnsavedCanvasAcceptedTasks(node, tasks, out=null){
    return CanvasAcceptedTaskRecovery.rememberUnsavedCanvasAcceptedTasks(classicAcceptedTaskRecoveryHost(), node, tasks, out);
}
function restoreUnsavedCanvasAcceptedTasks(){
    return CanvasAcceptedTaskRecovery.restoreUnsavedCanvasAcceptedTasks(classicAcceptedTaskRecoveryHost());
}
function confirmCanvasUnknownResubmission(node, opts={}){
    return CanvasAcceptedTaskRecovery.confirmCanvasUnknownResubmission(classicAcceptedTaskRecoveryHost(), node, opts);
}
function pauseCanvasAcceptedTasksUntilSaved(node, tasks, out=null){
    return CanvasAcceptedTaskRecovery.pauseCanvasAcceptedTasksUntilSaved(classicAcceptedTaskRecoveryHost(), node, tasks, out);
}
function rememberCanvasSubmissionWarning(node, warning, unknown=false){
    return CanvasAcceptedTaskRecovery.rememberCanvasSubmissionWarning(classicAcceptedTaskRecoveryHost(), node, warning, unknown);
}
async function createCanvasImageTask(payload, options={}){
    return CanvasTaskTransport.createCanvasImageTask({
        cascadeFetch:(...args)=>cascadeFetch(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        tr:(...args)=>tr(...args)
    }, payload, options);
}
async function submitCanvasImageTaskBatch(count, payload, options={}){
    return CanvasTaskTransport.submitCanvasImageTaskBatch({
        cascadeAbortError:(...args)=>cascadeAbortError(...args),
        cascadeContextFor:(...args)=>cascadeContextFor(...args),
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        tr:(...args)=>tr(...args)
    }, count, payload, options);
}
async function createCanvasComfyTask(payload, options={}){
    return CanvasTaskTransport.createCanvasComfyTask({
        actionFailed:(...args)=>actionFailed(...args),
        cascadeFetch:(...args)=>cascadeFetch(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args)
    }, payload, options);
}
async function waitCanvasComfyTaskResult(taskId, options={}){
    return CanvasTaskTransport.waitCanvasComfyTaskResult({
        actionFailed:(...args)=>actionFailed(...args),
        cascadeBackendRestartMessage:(...args)=>cascadeBackendRestartMessage(...args),
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        ensureCascadeActive:(...args)=>ensureCascadeActive(...args),
        isCascadeAbortError:(...args)=>isCascadeAbortError(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        sleep:(...args)=>sleep(...args)
    }, taskId, options);
}
async function runQueuedComfyGenerate(payload, options={}){
    return CanvasDirectTasks.runQueuedComfyGenerate(classicGenerationHost(), payload, options);
}
function completeCanvasComfyTask(taskId, result){
    return CanvasTaskResults.completeCanvasComfyTask(classicTaskRuntimeHost(), taskId, result);
}
async function pollCanvasComfyTask(taskId){
    return CanvasTaskRuntime.pollCanvasComfyTask(classicTaskRuntimeHost(), taskId);
}
function extractUpstreamTaskId(text){
    return CanvasOutputRecovery.extractUpstreamTaskId(classicOutputCoordinationHost(), text);
}
function providerIdForPending(pending){
    return CanvasOutputRecovery.providerIdForPending(classicOutputCoordinationHost(), pending);
}
function completeRecoverPendingOutput(out, pending, result){
    return CanvasOutputRecovery.completeRecoverPendingOutput(classicOutputCoordinationHost(), out, pending, result);
}
async function queryRecoverPendingOutput(pendingId){
    return CanvasOutputRecovery.queryRecoverPendingOutput(classicOutputCoordinationHost(), pendingId);
}
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
async function saveAndQueryCanvasPendingTask(pending){
    return CanvasOutputRecovery.saveAndQueryCanvasPendingTask(classicOutputCoordinationHost(), pending);
}
async function pollCanvasRunningHubTask(taskId, options={}){
    return CanvasTaskRuntime.pollCanvasRunningHubTask(classicTaskRuntimeHost(), taskId, options);
}
async function pollCanvasImageTask(taskId, options={}){
    return CanvasTaskRuntime.pollCanvasImageTask(classicTaskRuntimeHost(), taskId, options);
}
async function waitCanvasImageTaskResult(taskId, options={}){
    return CanvasTaskTransport.waitCanvasImageTaskResult({
        cascadeBackendRestartMessage:(...args)=>cascadeBackendRestartMessage(...args),
        cascadeFetch:(...args)=>cascadeFetch(...args),
        cascadeTargetIdFromOptions:(...args)=>cascadeTargetIdFromOptions(...args),
        ensureCascadeActive:(...args)=>ensureCascadeActive(...args),
        isCascadeAbortError:(...args)=>isCascadeAbortError(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        sleep:(...args)=>sleep(...args),
        tr:(...args)=>tr(...args)
    }, taskId, options);
}
function materializeCanvasDirectTasks(node, pendingTasks){
    return CanvasDirectTasks.materializeCanvasDirectTasks(classicGenerationHost(), node, pendingTasks);
}
async function waitCanvasDirectTasks(node, taskInfos, run, options={}){
    return CanvasDirectTasks.waitCanvasDirectTasks(classicGenerationHost(), node, taskInfos, run, options);
}
function completeCanvasImageTask(taskId, result){
    return CanvasTaskResults.completeCanvasImageTask(classicTaskRuntimeHost(), taskId, result);
}
function failCanvasImageTask(taskId, message, taskData={}){
    return CanvasTaskResults.failCanvasImageTask(classicTaskRuntimeHost(), taskId, message, taskData);
}
function resumeCanvasImageTasks(){
    return CanvasTaskRuntime.resumeCanvasImageTasks(classicTaskRuntimeHost());
}
function renderOutputMedia(item, useGridLayout=false){
    return CanvasOutputView.renderOutputMedia(classicOutputViewHost(), item, useGridLayout);
}
function outputGridLayout(node){
    return CanvasOutputView.outputGridLayout(classicOutputViewHost(), node);
}
function renderOutputGrid(node, pendingHtml=''){
    return CanvasOutputView.renderOutputGrid(classicOutputViewHost(), node, pendingHtml);
}
function outputImageName(url){
    const clean = (url || '').split('?')[0];
    const name = clean.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : 'output image';
}
function setOutputDragPreview(event, img){
    return CanvasOutputView.setOutputDragPreview(classicOutputViewHost(), event, img);
}
function appendOutputImages(out, images, compareRef, metas=[], layout=null){
    return CanvasTaskResults.appendOutputImages(classicTaskRuntimeHost(), out, images, compareRef, metas, layout);
}
function outputCompareUrlFor(url, out){
    return CanvasOutputPreview.outputCompareUrlFor(classicOutputViewHost(), url, out);
}
function markOutputViewed(out, url){
    return CanvasOutputPreview.markOutputViewed(classicOutputViewHost(), out, url);
}
function outputLightboxItems(out=null){
    return CanvasOutputPreview.outputLightboxItems(classicOutputViewHost(), out);
}
function openGroupLightbox(groupId, index=0){
    return CanvasOutputPreview.openGroupLightbox(classicOutputViewHost(), groupId, index);
}
function navigateOutputLightbox(direction){
    return CanvasOutputPreview.navigateOutputLightbox(classicOutputViewHost(), direction);
}
function createImageCardFromOutput(url, point){
    if(!ensureCanvas() || !url) return;
    if(!['image','audio'].includes(mediaKindForRef(url))) return;
    const p = point || defaultPoint(0, 0);
    nodes.push({id:uid('img'), type:isAudioUrl(url)?'audio':'image', x:p.x, y:p.y, url, name:outputImageName(url)});
    render();
    scheduleSave();
}
async function downloadUrl(url, filename){
    const res = await fetch(url);
    if(!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function setOutputCompareMode(active){
    return CanvasOutputPreview.setOutputCompareMode(classicOutputViewHost(), active);
}
function outputResolutionText(text, meta=null){
    return CanvasOutputPreview.outputResolutionText(classicOutputViewHost(), text, meta);
}
function setupOutputPromptPanel(meta){
    return CanvasOutputPreview.setupOutputPromptPanel(classicOutputViewHost(), meta);
}
promptTemplateSearch?.addEventListener('input', event => {
    promptTemplateQuery = event.target.value || '';
    renderPromptTemplateModal();
});
promptTemplateLibrarySelect?.addEventListener('change', () => {
    activePromptLibraryId = promptTemplateLibrarySelect.value || 'system';
    canvasPromptTemplates = activeCanvasPromptLibraryItems();
    promptTemplateSelectedId = '';
    promptTemplateEditing = false;
    renderPromptTemplateModal();
});
if(promptTemplateClose) promptTemplateClose.onclick = closePromptTemplateModal;
promptTemplatePanel?.addEventListener('pointerdown', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('mousedown', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('wheel', e => e.stopPropagation(), {passive:false});
promptTemplatePanel?.addEventListener('click', event => {
    event.stopPropagation();
    const apply = event.target.closest('[data-template-apply],[data-prompt-template-apply]');
    if(apply){
        applyPromptTemplateToPromptNode(apply.dataset.templateApply || apply.dataset.promptTemplateApply || 'positive');
        return;
    }
    if(event.target.closest('[data-template-save-current],[data-prompt-template-save-current]')){ saveCurrentCanvasPromptAsTemplate(); return; }
    if(event.target.closest('[data-template-new],[data-prompt-template-new]')){ createBlankCanvasPromptTemplate(); return; }
    if(event.target.closest('[data-template-edit],[data-prompt-template-edit]')){
        promptTemplateEditing = true;
        renderPromptTemplateModal();
        return;
    }
    if(event.target.closest('[data-template-edit-cancel],[data-prompt-template-edit-cancel]')){ promptTemplateEditing = false; renderPromptTemplateModal(); return; }
    if(event.target.closest('[data-template-edit-save],[data-prompt-template-edit-save]')){ saveCanvasPromptTemplateEdit(); return; }
    if(event.target.closest('[data-template-delete],[data-prompt-template-delete]')){
        deleteCanvasPromptTemplate();
        return;
    }
    const cat = event.target.closest('[data-template-cat],[data-prompt-template-cat]');
    if(cat){
        promptTemplateCategory = cat.dataset.templateCat || cat.dataset.promptTemplateCat || 'all';
        promptTemplateSelectedId = '';
        promptTemplateEditing = false;
        renderPromptTemplateModal();
        return;
    }
    const catEdit = event.target.closest('[data-template-cat-edit]');
    if(catEdit){
        renameCanvasPromptTemplateGroup(catEdit.dataset.templateCatEdit || '');
        return;
    }
    const catDelete = event.target.closest('[data-template-cat-delete]');
    if(catDelete){
        deleteCanvasPromptTemplateGroup(catDelete.dataset.templateCatDelete || '');
        return;
    }
    if(event.target.closest('[data-template-group-edit]')){
        promptTemplateGroupEditMode = !promptTemplateGroupEditMode;
        renderPromptTemplateModal();
        return;
    }
    if(event.target.closest('[data-template-cat-new]')){ createCanvasPromptTemplateGroup(); return; }
    const item = event.target.closest('[data-template-id],[data-prompt-template-id]');
    if(item){
        promptTemplateSelectedId = item.dataset.templateId || item.dataset.promptTemplateId || '';
        promptTemplateEditing = false;
        renderPromptTemplateModal();
        return;
    }
});
canvasAssetToggle?.addEventListener('click', () => toggleCanvasAssetLibrary());
workflowTransferToggle?.addEventListener('click', () => {
    if(workflowTransferModal?.classList.contains('open')) closeWorkflowTransferModal();
    else openWorkflowTransferModal();
});
canvasLogToggle?.addEventListener('click', event => {
    event.preventDefault();
    openCanvasLog();
});
workflowImportInput?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if(file) importWorkflowFile(file);
    event.target.value = '';
});
workflowImportDropZone?.addEventListener('click', () => workflowImportInput?.click());
workflowImportDropZone?.addEventListener('dragenter', event => {
    event.preventDefault();
    event.stopPropagation();
    workflowImportDropZone.classList.add('drag-over');
});
workflowImportDropZone?.addEventListener('dragover', event => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    workflowImportDropZone.classList.add('drag-over');
});
workflowImportDropZone?.addEventListener('dragleave', event => {
    event.preventDefault();
    event.stopPropagation();
    if(!workflowImportDropZone.contains(event.relatedTarget)) workflowImportDropZone.classList.remove('drag-over');
});
workflowImportDropZone?.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    workflowImportDropZone.classList.remove('drag-over');
    const file = [...(event.dataTransfer?.files || [])].find(item => /\.(json|zip)$/i.test(item.name || ''));
    if(file) importWorkflowFile(file);
    else setStatus('请拖入 JSON 或 ZIP 工作流文件');
});
canvasAssetCloseBtn?.addEventListener('click', () => toggleCanvasAssetLibrary(false));
canvasAssetLibrarySelect?.addEventListener('change', () => {
    activeCanvasAssetLibraryId = canvasAssetLibrarySelect.value || '';
    activeCanvasAssetCategoryId = '';
    renderCanvasAssetLibrary();
});
canvasAssetCategorySelect?.addEventListener('change', () => {
    activeCanvasAssetCategoryId = canvasAssetCategorySelect.value || '';
    renderCanvasAssetLibrary();
});
canvasAssetAddCategoryBtn?.addEventListener('click', async () => {
    if(canvasAssetLibraryIsLocal()){ setStatus('本地素材请在素材库管理中管理文件夹'); return; }
    const name = window.prompt('新分组名称', '新分组');
    if(!String(name || '').trim()) return;
    const data = await fetch('/api/asset-library/categories', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({library_id:activeCanvasAssetLibraryId, name:String(name).trim(), type:'image'})
    }).then(r => r.json());
    canvasAssetLibrary = data.library || canvasAssetLibrary;
    activeCanvasAssetCategoryId = data.category?.id || activeCanvasAssetCategoryId;
    renderCanvasAssetLibrary();
});
canvasAssetPanel?.addEventListener('wheel', event => {
    event.stopPropagation();
    const scroller = event.target.closest?.('.canvas-asset-grid') || canvasAssetGrid;
    if(!scroller || getComputedStyle(scroller).display === 'none') return;
    const canScroll = scroller.scrollHeight > scroller.clientHeight || scroller.scrollWidth > scroller.clientWidth;
    if(!canScroll) return;
    event.preventDefault();
    scroller.scrollTop += event.deltaY;
    scroller.scrollLeft += event.deltaX;
}, {passive:false, capture:true});
workflowTransferModal?.addEventListener('wheel', event => {
    event.stopPropagation();
}, {passive:true, capture:true});
workflowTransferModal?.addEventListener('dragover', event => {
    event.preventDefault();
    event.stopPropagation();
    if(workflowImportDropZone){
        event.dataTransfer.dropEffect = 'copy';
        workflowImportDropZone.classList.add('drag-over');
    }
});
workflowTransferModal?.addEventListener('dragleave', event => {
    event.preventDefault();
    event.stopPropagation();
    if(!workflowTransferModal.contains(event.relatedTarget)) workflowImportDropZone?.classList.remove('drag-over');
});
workflowTransferModal?.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    workflowImportDropZone?.classList.remove('drag-over');
    const file = [...(event.dataTransfer?.files || [])].find(item => /\.(json|zip)$/i.test(item.name || ''));
    if(file) importWorkflowFile(file);
    else setStatus('请拖入 JSON 或 ZIP 工作流文件');
});
function hasCanvasAssetSaveDrop(dataTransfer){
    return hasOutputImageDrag(dataTransfer) || hasImageDropData(dataTransfer);
}
canvasAssetDropZone?.addEventListener('dragover', event => {
    if(!hasCanvasAssetSaveDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    canvasAssetDropZone.classList.add('drag-over');
});
canvasAssetDropZone?.addEventListener('dragleave', () => canvasAssetDropZone.classList.remove('drag-over'));
canvasAssetDropZone?.addEventListener('drop', async event => {
    if(!hasCanvasAssetSaveDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    canvasAssetDropZone.classList.remove('drag-over');
    try {
        if(hasOutputImageDrag(event.dataTransfer)){
            await addUrlToCanvasAssetLibrary(event.dataTransfer.getData('application/x-canvas-output-image'), 'output');
            return;
        }
        const payload = await resolveImageDropPayload(event.dataTransfer);
        if(payload.type === 'files'){
            const cat = activeCanvasAssetCategory();
            const data = cat ? await uploadFilesToLibrary(payload.files, activeCanvasAssetLibraryId, cat.id) : null;
            if(data?.library) {
                canvasAssetLibrary = data.library;
                renderCanvasAssetLibrary();
                setStatus('已保存到资产库');
            }
        } else if(payload.type === 'url') {
            await addUrlToCanvasAssetLibrary(payload.url, outputImageName(payload.url));
        }
    } catch(err) {
        showErrorModal(err.message || '保存资产失败', '保存资产失败');
    }
});
gateAssetManagerBtn?.addEventListener('click', openAssetManager);
const classicAssetManagerController=CanvasAssetManager.create(classicAssetManagerHost);
classicAssetManagerController.mount();


function rerunFromOutputMeta(meta){
    if(!ensureCanvas() || !meta?.run?.nodeType) return;
    const base = JSON.parse(JSON.stringify(meta.run.node || {}));
    const p = defaultPoint(180, 40);
    const node = {...base, id:uid(base.type || meta.run.nodeType), type:meta.run.nodeType, x:p.x, y:p.y, inputs:[], running:false};
    nodes.push(node);
    const prompt = meta.run.prompt || '';
    if(prompt){
        const promptNode = {id:uid('pr'), type:'prompt', x:p.x - 340, y:p.y, text:prompt};
        nodes.push(promptNode);
        connections.push({id:uid('c'), from:promptNode.id, to:node.id});
    }
    (meta.run.refs || []).slice(0, 8).forEach((ref, i) => {
        const imgNode = {id:uid('img'), type:'image', x:p.x - 340, y:p.y + 110 + i * 86, url:ref.url, name:ref.name || 'image'};
        nodes.push(imgNode);
        connections.push({id:uid('c'), from:imgNode.id, to:node.id});
    });
    closeOutputLightbox();
    render();
    scheduleSave();
}
function updateOutputCompareSlider(clientX){
    return CanvasOutputPreview.updateOutputCompareSlider(classicOutputViewHost(), clientX);
}
function applyOutputPreviewZoom(){
    return CanvasOutputPreview.applyOutputPreviewZoom(classicOutputViewHost());
}
function resetOutputPreviewZoom(){
    return CanvasOutputPreview.resetOutputPreviewZoom(classicOutputViewHost());
}
function initOutputPreviewZoomEvents(){
    return CanvasOutputPreview.initOutputPreviewZoomEvents(classicOutputViewHost());
}
function initOutputCompareEvents(){
    return CanvasOutputPreview.initOutputCompareEvents(classicOutputViewHost());
}
function openOutputLightbox(url, out){
    return CanvasOutputPreview.openOutputLightbox(classicOutputViewHost(), url, out);
}
function closeOutputLightbox(){
    return CanvasOutputPreview.closeOutputLightbox(classicOutputViewHost());
}
function setCanvasGroupMembers(group, memberIds){
    return CanvasGroupEdit.setCanvasGroupMembers(classicNodeEditHost(), group, memberIds);
}
function groupSelectedImages(){
    return CanvasGroupEdit.groupSelectedImages(classicNodeEditHost());
}
function nodeBounds(ids){
    return CanvasLayout.nodeBounds(classicLayoutHost(), ids);
}

function startSelection(e){
    return CanvasInteraction.startSelection(classicLayoutHost(), e);
}
function updateSelectionBox(x, y){
    return CanvasInteraction.updateSelectionBox(classicLayoutHost(), x, y);
}
function finishSelection(){
    return CanvasInteraction.finishSelection(classicLayoutHost());
}
function renderSelectionHub(){
    return CanvasInteraction.renderSelectionHub(classicLayoutHost());
}
function startSelectionLink(e, kind){
    return CanvasInteraction.startSelectionLink(classicLayoutHost(), e, kind);
}
function connectSelectionToGenerator(kind, genId){
    return CanvasGroupEdit.connectSelectionToGenerator(classicNodeEditHost(), kind, genId);
}

function classicHistoryHost(){
    return {
        get canvas(){return canvas;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get connections(){return connections;},
        set connections(value){connections=value;},
        serializableCanvasNodes:(...args)=>serializableCanvasNodes(...args),
        get window(){return window;},
        get selected(){return selected;},
        render:(...args)=>render(...args),
        scheduleSave:(...args)=>scheduleSave(...args)
    };
}
function pushUndo(){
    return classicHistory.pushUndo();
}
function performUndo(){
    return classicHistory.performUndo();
}
function cloneNode(n, dx, dy){
    return CanvasNodeEdit.cloneNode(classicNodeEditHost(), n, dx, dy);
}
function canvasNodesWithGroupMembers(ids){
    return CanvasNodeEdit.canvasNodesWithGroupMembers(classicNodeEditHost(), ids);
}
function duplicateNodesForAltDrag(node, preserveConnections=false){
    return CanvasNodeEdit.duplicateNodesForAltDrag(classicNodeEditHost(), node, preserveConnections);
}
function copySelectedNodes(){
    return CanvasNodeEdit.copySelectedNodes(classicNodeEditHost());
}
function clipboardNodeCount(){
    return CanvasNodeEdit.clipboardNodeCount(classicNodeEditHost());
}
function pasteNodes(){
    return CanvasNodeEdit.pasteNodes(classicNodeEditHost());
}
function classicWorkflowTransferHost(){
    return {
        captureMediaInputContext:()=>classicMediaInputController.capture(),
        get activeCanvasAssetCategoryId(){return activeCanvasAssetCategoryId;},
        set activeCanvasAssetCategoryId(value){activeCanvasAssetCategoryId=value;},
        get activeCanvasAssetLibraryId(){return activeCanvasAssetLibraryId;},
        set activeCanvasAssetLibraryId(value){activeCanvasAssetLibraryId=value;},
        get assetManagerModal(){return assetManagerModal;},
        get canvas(){return canvas;},
        get canvasAssetLibrary(){return canvasAssetLibrary;},
        set canvasAssetLibrary(value){canvasAssetLibrary=value;},
        get canvasAssetLibraryOpen(){return canvasAssetLibraryOpen;},
        get connections(){return connections;},
        get lastMouseBoard(){return lastMouseBoard;},
        get missingAssetUrls(){return missingAssetUrls;},
        get nodes(){return nodes;},
        get selected(){return selected;},
        get window(){return window;},
        get workflowExportLibraryBtn(){return workflowExportLibraryBtn;},
        get workflowExportMeta(){return workflowExportMeta;},
        get workflowImportDropZone(){return workflowImportDropZone;},
        get workflowTransferModal(){return workflowTransferModal;},
        get workflowTransferSub(){return workflowTransferSub;},
        get workflowTransferToggle(){return workflowTransferToggle;},
        get File(){return File;},
        activeCanvasAssetLibrary:(...args)=>activeCanvasAssetLibrary(...args),
        canvasAssetLibraries:(...args)=>canvasAssetLibraries(...args),
        canvasLocalAssetUrls:(...args)=>canvasLocalAssetUrls(...args),
        canvasNodesWithGroupMembers:(...args)=>canvasNodesWithGroupMembers(...args),
        defaultPoint:(...args)=>defaultPoint(...args),
        downloadBlob:(...args)=>downloadBlob(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        findCanvasAssetCategoryForItem:(...args)=>findCanvasAssetCategoryForItem(...args),
        loadCanvasAssetLibrary:(...args)=>loadCanvasAssetLibrary(...args),
        pushUndo:(...args)=>pushUndo(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        refreshMissingCanvasAssets:(...args)=>refreshMissingCanvasAssets(...args),
        remapCanvasDepthCopies:(...args)=>remapCanvasDepthCopies(...args),
        render:(...args)=>render(...args),
        renderAssetManager:(...args)=>renderAssetManager(...args),
        renderCanvasAssetLibrary:(...args)=>renderCanvasAssetLibrary(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        sanitizeConnections:(...args)=>sanitizeConnections(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        serializableCanvasNode:(...args)=>serializableCanvasNode(...args),
        serializableCanvasNodes:(...args)=>serializableCanvasNodes(...args),
        setStatus:(...args)=>setStatus(...args),
        setTimeout:(...args)=>setTimeout(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        syncGeneratorInputs:(...args)=>syncGeneratorInputs(...args),
        toggleCanvasAssetLibrary:(...args)=>toggleCanvasAssetLibrary(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function selectedWorkflowPayload(){
    return CanvasWorkflowTransfer.selectedWorkflowPayload(classicWorkflowTransferHost());
}
function workflowFilename(ext){
    return CanvasWorkflowTransfer.workflowFilename(classicWorkflowTransferHost(), ext);
}
function downloadBlob(blob, filename){
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
}
async function canvasAssistantExportWorkflow({actionId,nodeId,nodeIds,connectionIds,includeResources,scopeHash,beforeDownload}){
    return CanvasWorkflowTransfer.canvasAssistantExportWorkflow(classicWorkflowTransferHost(), {actionId,nodeId,nodeIds,connectionIds,includeResources,scopeHash,beforeDownload});
}
function downloadUrl(url, filename='download'){
    if(!url) return Promise.resolve(false);
    const raw = canvasOriginalMediaUrl(url);
    const href = (raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('/api/download-output'))
        ? raw
        : `/api/download-output?url=${encodeURIComponent(raw)}&name=${encodeURIComponent(filename || outputDownloadName(raw))}`;
    const link = document.createElement('a');
    link.href = href;
    link.download = filename || '';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return Promise.resolve(true);
}
function openWorkflowTransferModal(){
    return CanvasWorkflowTransfer.openWorkflowTransferModal(classicWorkflowTransferHost());
}
function closeWorkflowTransferModal(){
    return CanvasWorkflowTransfer.closeWorkflowTransferModal(classicWorkflowTransferHost());
}
function updateWorkflowTransferMeta(){
    return CanvasWorkflowTransfer.updateWorkflowTransferMeta(classicWorkflowTransferHost());
}
function setWorkflowLibraryExportState(state='idle', text='导出到资产库'){
    return CanvasWorkflowTransfer.setWorkflowLibraryExportState(classicWorkflowTransferHost(), state, text);
}
async function exportSelectedWorkflow(includeResources=false){
    return CanvasWorkflowTransfer.exportSelectedWorkflow(classicWorkflowTransferHost(), includeResources);
}
function defaultWorkflowAssetTarget(){
    return CanvasWorkflowTransfer.defaultWorkflowAssetTarget(classicWorkflowTransferHost());
}
async function exportSelectedWorkflowToLibrary(){
    return CanvasWorkflowTransfer.exportSelectedWorkflowToLibrary(classicWorkflowTransferHost());
}
function findCanvasAssetCategoryForItem(itemId){
    for(const lib of canvasAssetLibraries()){
        for(const cat of lib.categories || []){
            if((cat.items || []).some(item => item.id === itemId)) return cat;
        }
    }
    return null;
}
function normalizeImportedWorkflow(data){
    return CanvasWorkflowTransfer.normalizeImportedWorkflow(classicWorkflowTransferHost(), data);
}
function insertWorkflowIntoCanvas(imported){
    return CanvasWorkflowTransfer.insertWorkflowIntoCanvas(classicWorkflowTransferHost(), imported);
}
async function importWorkflowFile(file){
    return CanvasWorkflowTransfer.importWorkflowFile(classicWorkflowTransferHost(), file);
}
function startNodeDrag(e, node){
    return CanvasInteraction.startNodeDrag(classicLayoutHost(), e, node);
}
function onNodeDrag(e){
    return CanvasInteraction.onNodeDrag(classicLayoutHost(), e);
}
function startNodeResize(e, node){
    return CanvasInteraction.startNodeResize(classicLayoutHost(), e, node);
}
function onNodeResize(e){
    return CanvasInteraction.onNodeResize(classicLayoutHost(), e);
}
function startLink(e, originId, originKind){
    return CanvasInteraction.startLink(classicLayoutHost(), e, originId, originKind);
}
function nearestPort(clientX, clientY, kind){
    return CanvasInteraction.nearestPort(classicLayoutHost(), clientX, clientY, kind);
}
function wouldCreateGeneratorCycle(fromId, toId){
    return CanvasGraphRules.wouldCreateGeneratorCycle(classicGraphHost(), fromId, toId);
}
function canConnect(fromId, toId){
    return CanvasGraphRules.canConnect(classicGraphHost(), fromId, toId);
}
function sanitizeConnections(){
    connections = (connections || []).filter(c => c.kind === 'story' ? validStoryConnection(c) : canConnect(c.from, c.to));
}
function validStoryConnection(c){
    return CanvasGraphRules.validStoryConnection(classicGraphHost(), c);
}
function endDrag(event=null){
    return CanvasInteraction.endDrag(classicLayoutHost(), event);
}
function nodeRect(n){
    return CanvasLayout.nodeRect(classicLayoutHost(), n);
}
function connectedClusterIds(seedId){
    return CanvasGraphRules.connectedClusterIds(classicGraphHost(), seedId);
}
function canvasArrangeAtomicIds(ids){
    return CanvasLayout.canvasArrangeAtomicIds(classicLayoutHost(), ids);
}
function translateCanvasNodeWithMembers(node, dx, dy, seen=new Set()){
    return CanvasLayout.translateCanvasNodeWithMembers(classicLayoutHost(), node, dx, dy, seen);
}
function moveCanvasNodeAtom(node, x, y){
    return CanvasLayout.moveCanvasNodeAtom(classicLayoutHost(), node, x, y);
}
function arrangeIdsByConnections(ids){
    return CanvasLayout.arrangeIdsByConnections(classicLayoutHost(), ids);
}
function arrangeSelectedCanvasNodes(){
    return CanvasLayout.arrangeSelectedCanvasNodes(classicLayoutHost());
}
function handoffExistingInputsToGroup(group, children){
    return CanvasGroupEdit.handoffExistingInputsToGroup(classicNodeEditHost(), group, children);
}
function updateGroupMembership(movedNodes){
    return CanvasGroupEdit.updateGroupMembership(classicNodeEditHost(), movedNodes);
}

function classicConnectionLayerHost(){
    return {
        get CSS(){return CSS;},
        get canvas(){return canvas;},
        get connections(){return connections;},
        get document(){return document;},
        get dragBoard(){return dragBoard;},
        get dragNode(){return dragNode;},
        get hoveredConnectionId(){return hoveredConnectionId;},
        set hoveredConnectionId(value){hoveredConnectionId=value;},
        get knifeActive(){return knifeActive;},
        get knifeTrail(){return knifeTrail;},
        get linkControlsEl(){return linkControlsEl;},
        get linksEl(){return linksEl;},
        get nodes(){return nodes;},
        get nodesEl(){return nodesEl;},
        get resizeNode(){return resizeNode;},
        get selected(){return selected;},
        get tempLink(){return tempLink;},
        get viewport(){return viewport;},
        deleteConnection:(...args)=>deleteConnection(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        tr:(...args)=>tr(...args)
    };
}
function portPoint(id, kind){
    return CanvasConnectionLayer.portPoint(classicConnectionLayerHost(), id, kind);
}
function canResolvePort(id){
    return CanvasConnectionLayer.canResolvePort(classicConnectionLayerHost(), id);
}
function renderLinks(){
    return CanvasConnectionLayer.renderLinks(classicConnectionLayerHost());
}
function renderKnifeTrail(){
    return CanvasConnectionLayer.renderKnifeTrail(classicConnectionLayerHost());
}
function linkDeleteButton(connection, a, b){
    return CanvasConnectionLayer.linkDeleteButton(classicConnectionLayerHost(), connection, a, b);
}
function linkHitEl(x1,y1,x2,y2,id){
    return CanvasConnectionLayer.linkHitEl(classicConnectionLayerHost(), x1, y1, x2, y2, id);
}
function setHoveredConnection(id){
    return CanvasConnectionLayer.setHoveredConnection(classicConnectionLayerHost(), id);
}
function connectionDistanceToPoint(connection, point){
    return CanvasConnectionLayer.connectionDistanceToPoint(classicConnectionLayerHost(), connection, point);
}
function updateConnectionHoverFromMouse(e){
    return CanvasConnectionLayer.updateConnectionHoverFromMouse(classicConnectionLayerHost(), e);
}
function isConnectionSelected(connection){
    return CanvasConnectionLayer.isConnectionSelected(classicConnectionLayerHost(), connection);
}
function refreshSelectionVisuals(){
    return CanvasInteraction.refreshSelectionVisuals(classicLayoutHost());
}
function pathEl(x1,y1,x2,y2,cls){
    return CanvasConnectionLayer.pathEl(classicConnectionLayerHost(), x1, y1, x2, y2, cls);
}
function pointSegmentDistance(p, a, b){
    return CanvasConnectionLayer.pointSegmentDistance(classicConnectionLayerHost(), p, a, b);
}
function segmentsIntersect(a, b, c, d){
    return CanvasConnectionLayer.segmentsIntersect(classicConnectionLayerHost(), a, b, c, d);
}
function segmentIntersectsRect(a, b, r){
    return CanvasConnectionLayer.segmentIntersectsRect(classicConnectionLayerHost(), a, b, r);
}
function cubicPoint(a, b, t){
    return CanvasConnectionLayer.cubicPoint(classicConnectionLayerHost(), a, b, t);
}
function knifeHitsConnection(a, b, connection){
    return CanvasInteraction.knifeHitsConnection(classicLayoutHost(), a, b, connection);
}
function applyKnifeCut(from, to){
    return CanvasInteraction.applyKnifeCut(classicLayoutHost(), from, to);
}
function setKnifeMode(active){
    return CanvasInteraction.setKnifeMode(classicLayoutHost(), active);
}
function startKnifeDrag(e){
    return CanvasInteraction.startKnifeDrag(classicLayoutHost(), e);
}
function continueKnifeDrag(e){
    return CanvasInteraction.continueKnifeDrag(classicLayoutHost(), e);
}
function isEditableTarget(target){
    return CanvasInteraction.isEditableTarget(classicLayoutHost(), target);
}
function setCanvasMouseMove(fn){
    return classicPointerController.setMouseMove(fn);
}
function setCanvasMouseUp(fn){
    return classicPointerController.setMouseUp(fn);
}
function classicPointerHost(){
    return {
        get board(){return board;},
        get canvas(){return canvas;},
        get canvasArrangeBtn(){return canvasArrangeBtn;},
        get document(){return document;},
        get dragBoard(){return dragBoard;},
        get dragNode(){return dragNode;},
        get isRKeyDown(){return isRKeyDown;},
        get knifeActive(){return knifeActive;},
        get lastMouseBoard(){return lastMouseBoard;},
        set lastMouseBoard(value){lastMouseBoard=value;},
        get linksEl(){return linksEl;},
        get minimap(){return minimap;},
        get minimapDrag(){return minimapDrag;},
        set minimapDrag(value){minimapDrag=value;},
        get nodesEl(){return nodesEl;},
        get resizeNode(){return resizeNode;},
        get tempLink(){return tempLink;},
        get viewport(){return viewport;},
        get window(){return window;},
        get world(){return world;},
        get zoomPreviewState(){return zoomPreviewState;},
        applyViewport:(...args)=>applyViewport(...args),
        arrangeSelectedCanvasNodes:(...args)=>arrangeSelectedCanvasNodes(...args),
        centerViewportOnWorldPoint:(...args)=>centerViewportOnWorldPoint(...args),
        closeCreateMenu:(...args)=>closeCreateMenu(...args),
        continueKnifeDrag:(...args)=>continueKnifeDrag(...args),
        exitZoomPreview:(...args)=>exitZoomPreview(...args),
        exitZoomPreviewToNode:(...args)=>exitZoomPreviewToNode(...args),
        isEditableTarget:(...args)=>isEditableTarget(...args),
        isZoomPreviewIgnoredTarget:(...args)=>isZoomPreviewIgnoredTarget(...args),
        minimapEventToWorld:(...args)=>minimapEventToWorld(...args),
        openCreateMenu:(...args)=>openCreateMenu(...args),
        renderLinks:(...args)=>renderLinks(...args),
        renderSelectionHub:(...args)=>renderSelectionHub(...args),
        scheduleViewportSave:(...args)=>scheduleViewportSave(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        setHoveredConnection:(...args)=>setHoveredConnection(...args),
        setKnifeMode:(...args)=>setKnifeMode(...args),
        startBoardPan:(...args)=>startBoardPan(...args),
        startKnifeDrag:(...args)=>startKnifeDrag(...args),
        startSelection:(...args)=>startSelection(...args),
        updateConnectionHoverFromMouse:(...args)=>updateConnectionHoverFromMouse(...args)
    ,
        backupClassicDraft:(...args)=>backupClassicDraft(...args),
        set dragBoard(value){dragBoard=value;},
        set dragNode(value){dragNode=value;},
        endDrag:(...args)=>endDrag(...args),
        set isRKeyDown(value){isRKeyDown=value;},
        set knifeActive(value){knifeActive=value;},
        get knifeChanged(){return knifeChanged;},
        set knifeChanged(value){knifeChanged=value;},
        get knifeNeedsRender(){return knifeNeedsRender;},
        set knifeNeedsRender(value){knifeNeedsRender=value;},
        get knifePoint(){return knifePoint;},
        set knifePoint(value){knifePoint=value;},
        get knifeTrail(){return knifeTrail;},
        set knifeTrail(value){knifeTrail=value;},
        get llmPaneDrag(){return llmPaneDrag;},
        set llmPaneDrag(value){llmPaneDrag=value;},
        get localCanvasDirty(){return localCanvasDirty;},
        set localCanvasDirty(value){localCanvasDirty=value;},
        set resizeNode(value){resizeNode=value;},
        saveLocalViewport:(...args)=>saveLocalViewport(...args),
        get selectDrag(){return selectDrag;},
        set selectDrag(value){selectDrag=value;},
        get selectionBox(){return selectionBox;},
        get selectionHub(){return selectionHub;},
        set tempLink(value){tempLink=value;},
        setCanvasMouseMove:(...args)=>setCanvasMouseMove(...args),
        setCanvasMouseUp:(...args)=>setCanvasMouseUp(...args)
    };
}
const classicPointerController=CanvasPointerEvents.create(classicPointerHost);
classicPointerController.mount();


function isZoomPreviewIgnoredTarget(target){
    return CanvasInteraction.isZoomPreviewIgnoredTarget(classicLayoutHost(), target);
}


function startBoardPan(e, opts={}){
    return CanvasInteraction.startBoardPan(classicLayoutHost(), e, opts);
}




board.ondblclick = null;



function classicMediaInputHost(){
    return {
        captureMediaInputContext:()=>classicMediaInputController.capture(),
        get board(){return board;},
        get canvas(){return canvas;},
        get canvasOpenGeneration(){return canvasOpenGeneration;},
        get dropOverlay(){return dropOverlay;},
        get internalDrag(){return internalDrag;},
        set internalDrag(value){internalDrag=value;},
        get lastImagePasteAt(){return lastImagePasteAt;},
        set lastImagePasteAt(value){lastImagePasteAt=value;},
        get nodes(){return nodes;},
        get selected(){return selected;},
        get window(){return window;},
        applyImageDropPayloadToBoard:(...args)=>applyImageDropPayloadToBoard(...args),
        createImageCardFromOutput:(...args)=>createImageCardFromOutput(...args),
        createImageCardFromUrl:(...args)=>createImageCardFromUrl(...args),
        fillImageNode:(...args)=>fillImageNode(...args),
        hasImageDropData:(...args)=>hasImageDropData(...args),
        hasOutputImageDrag:(...args)=>hasOutputImageDrag(...args),
        importWorkflowAssetUrl:(...args)=>importWorkflowAssetUrl(...args),
        isCanvasInputDrag:(...args)=>isCanvasInputDrag(...args),
        langIsEn:(...args)=>langIsEn(...args),
        resolveImageDropPayload:(...args)=>resolveImageDropPayload(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        setStatus:(...args)=>setStatus(...args),
        showErrorModal:(...args)=>showErrorModal(...args),
        uploadImageGroup:(...args)=>uploadImageGroup(...args),
        uploadImages:(...args)=>uploadImages(...args)
    };
}
const classicMediaInputController=CanvasMediaInputEvents.create(classicMediaInputHost);
classicMediaInputController.mount();





function classicKeyboardHost(){
    return {
        clearTimeout:(...args)=>clearTimeout(...args),
        get canvasOpenGeneration(){return canvasOpenGeneration;},
        get assetManagerModal(){return assetManagerModal;},
        get canvas(){return canvas;},
        get document(){return document;},
        get dragBoard(){return dragBoard;},
        get dragNode(){return dragNode;},
        get isRKeyDown(){return isRKeyDown;},
        set isRKeyDown(value){isRKeyDown=value;},
        get knifeActive(){return knifeActive;},
        get lastImagePasteAt(){return lastImagePasteAt;},
        get llmPaneDrag(){return llmPaneDrag;},
        get logModal(){return logModal;},
        get minimapDrag(){return minimapDrag;},
        get outputLightbox(){return outputLightbox;},
        get promptTemplateModal(){return promptTemplateModal;},
        get resizeNode(){return resizeNode;},
        get selectDrag(){return selectDrag;},
        set selectDrag(value){selectDrag=value;},
        get selected(){return selected;},
        get selectionBox(){return selectionBox;},
        get window(){return window;},
        get workflowTransferModal(){return workflowTransferModal;},
        clipboardNodeCount:(...args)=>clipboardNodeCount(...args),
        closeImageEditor:(...args)=>closeImageEditor(...args),
        closeOutputLightbox:(...args)=>closeOutputLightbox(...args),
        closePromptTemplateModal:(...args)=>closePromptTemplateModal(...args),
        copySelectedNodes:(...args)=>copySelectedNodes(...args),
        deleteSelectedNodes:(...args)=>deleteSelectedNodes(...args),
        endDrag:(...args)=>endDrag(...args),
        groupSelectedImages:(...args)=>groupSelectedImages(...args),
        isEditableTarget:(...args)=>isEditableTarget(...args),
        navigateOutputLightbox:(...args)=>navigateOutputLightbox(...args),
        pasteNodes:(...args)=>pasteNodes(...args),
        performUndo:(...args)=>performUndo(...args),
        setCanvasMouseMove:(...args)=>setCanvasMouseMove(...args),
        setCanvasMouseUp:(...args)=>setCanvasMouseUp(...args),
        setKnifeMode:(...args)=>setKnifeMode(...args),
        setTimeout:(...args)=>setTimeout(...args),
        toggleZoomPreview:(...args)=>toggleZoomPreview(...args)
    };
}
const classicKeyboardController=CanvasKeyboardEvents.create(classicKeyboardHost);
classicKeyboardController.mount();



function deleteSelectedNodes(){
    return CanvasNodeEdit.deleteSelectedNodes(classicNodeEditHost());
}
function hasImageFiles(items){
    return [...(items || [])].some(item => {
        const entry = dataTransferItemEntry(item);
        return entry?.isDirectory || (item.kind === 'file' && (/^(image|video|audio)\//.test(String(item.type || '')) || isSupportedUploadFile(item.getAsFile?.())));
    });
}
function isCanvasInputDrag(dataTransfer){
    return internalDrag || [...(dataTransfer?.types || [])].includes('application/x-canvas-input');
}
function hasImageDropData(dataTransfer){
    if(!dataTransfer) return false;
    if(isCanvasInputDrag(dataTransfer)) return false;
    if(imageFilesFromDataTransfer(dataTransfer).length) return true;
    if(hasImageFiles(dataTransfer.items)) return true;
    const types = dropDataTypes(dataTransfer);
    if(types.some(type => IMAGE_DROP_TYPE_HINT_RE.test(type.toLowerCase()))) return true;
    return imageDropPayload(dataTransfer).type !== 'none';
}
function hasOutputImageDrag(dataTransfer){ return [...(dataTransfer?.types || [])].includes('application/x-canvas-output-image'); }
function escapeHtml(str){ return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function escapeAttr(str){ return escapeHtml(str); }

function mergeCanvasAssistantChanges(remote){
    if(!canvas || !remote || remote.id !== canvas.id) return false;
    const receipts=remote.assistant_receipts||{};
    const changes=Object.entries(receipts).filter(([key])=>!canvas.assistant_receipts?.[key]);
    if(!changes.length) return false;
    const byId=new Map(nodes.map(node=>[node.id,node]));
    const remoteById=new Map((remote.nodes||[]).map(node=>[node.id,node]));
    let conflict=false;
    changes.sort((a,b)=>(a[1].updatedAtAfter||0)-(b[1].updatedAtAfter||0));
    for(const [,receipt] of changes){
        for(const id of receipt.createdNodeIds||[]){
            if(!byId.has(id) && remoteById.has(id)){
                const node=structuredClone(remoteById.get(id));nodes.push(node);byId.set(id,node);
            }
        }
        for(const patch of receipt.nodePatches||[]){
            const node=byId.get(patch.nodeId);
            if(!node) continue; // 保留用户本地删除。
            for(const [name,value] of Object.entries(patch.fields)){
                if(JSON.stringify(node[name]??null)===JSON.stringify(value.before)) node[name]=structuredClone(value.after);
                else if(JSON.stringify(node[name]??null)!==JSON.stringify(value.after)) conflict=true;
            }
        }
        for(const id of receipt.createdEdgeIds||[]){
            const edge=(remote.connections||[]).find(item=>item.id===id);
            if(edge && byId.has(edge.from) && byId.has(edge.to) && !connections.some(item=>item.from===edge.from && item.to===edge.to)) connections.push(structuredClone(edge));
        }
    }
    canvas.assistant_receipts=structuredClone(receipts);
    canvas.updated_at=Number(remote.updated_at||0);lastCanvasUpdatedAt=canvas.updated_at;
    render();
    if(conflict) setStatus('助手与手动修改冲突，已保留手动修改');
    return true;
}
function canvasAssistantCreationSettings(){
    const picked=nodes.filter(node=>selected.has(node.id));
    const image=picked.find(node=>node.type==='generator')||[...nodes].reverse().find(node=>node.type==='generator');
    const video=picked.find(node=>node.type==='video')||[...nodes].reverse().find(node=>node.type==='video');
    return {engine:'api',provider_id:image?.apiProvider||'',model:image?.model||'',ratio:image?.ratio||'square',resolution:image?.resolution||'1k',quality:image?.quality||'auto',
        customRatio:image?.customRatio||'',customSize:image?.customSize||'',customRatioWidth:image?.customRatioWidth||'',customRatioHeight:image?.customRatioHeight||'',customWidth:image?.customWidth||'',customHeight:image?.customHeight||'',
        videoProvider:video?.apiProvider||'',videoModel:video?.model||'',videoDuration:video?.duration||5,videoAspect:video?.aspectRatio||'16:9',videoResolution:video?.resolution||'',
        videoEnhancePrompt:!!video?.enhancePrompt,videoEnableUpsample:!!video?.enableUpsample,videoWatermark:!!video?.watermark,videoCameraFixed:!!video?.cameraFixed,videoGenerateAudio:!!video?.generateAudio,videoMultimodal:!!video?.multimodal,videoUseFrameRoles:!!video?.useFrameRoles};
}
async function canvasAssistantImageRequest(proposal){
    const node=nodes.find(n=>n.id===proposal.nodeId && n.type==='generator');
    if(!canvas || canvas.id!==proposal.canvasId || !node) throw new Error('画布或生成节点已变化，请重新提出方案');
    if(node.running || node._directPending?.length || nodes.some(n=>(n._pending||[]).some(p=>p.run?.node?.id===node.id))) throw new Error('该节点还有原任务，请先在画布查询或恢复原任务');
    // 方案确认时以用户本轮明确选择的平台/模型为准，避免沿用画布中旧生成节点的配置。
    if(proposal.provider && proposal.model){ node.apiProvider=proposal.provider; node.model=proposal.model; }
    const refs=proposal.referenceImages.map(url=>({url,kind:'image'}));
    return {prompt:proposal.prompt,provider_id:node.apiProvider,model:node.model,size:await generatorSizeForRun({...node},refs),
        reference_images:refs,quality:normalizedImageQuality(node.quality)||'auto',n:1};
}
async function canvasAssistantGenerateImage(proposal,task){
    const node=nodes.find(n=>n.id===proposal.nodeId && n.type==='generator');
    if(!canvas || canvas.id!==proposal.canvasId || !node || !task?.task_id) throw new Error('画布或任务已变化，请查询原任务');
    if(node.assistantCompletedTaskId===task.task_id || (node.assistantTaskId===task.task_id && node.runStatus==='done')) return;
    if(nodes.some(n=>(n._pending||[]).some(p=>p.canvasTaskId===task.task_id)) || (node._directPending||[]).some(p=>p.canvasTaskId===task.task_id)){
        await pollCanvasImageTask(task.task_id);return;
    }
    if(node.running) throw new Error('该节点正在生成，请查看画布中的任务');
    node.assistantTaskId=task.task_id;
    await runGenerator(node.id,{assistantProposal:proposal,acceptedTask:task});
    await saveCanvas();
}
async function saveCanvasAssistantSnapshot(){

    return saveCanvas();
}
window.onload = async () => {
    initCanvasClipBridge();
    initCanvasVideoDeconstructionBridge();
    applyTheme(localStorage.getItem('studio_theme') || localStorage.getItem(CANVAS_THEME_KEY) || 'light');
    if(window.StudioI18n) StudioI18n.apply();
    document.title = tr('canvas.title');
    initOutputCompareEvents();
    initOutputPreviewZoomEvents();
    applyViewport();
    await loadConfig();
    pruneMissingComfyWorkflows();
    // 编辑器页只负责打开单个画布：必须带 ?id；没有 id 就回到独立的选画布页面。
    const openId = new URLSearchParams(window.location.search).get('id');
    if(openId){
        await openCanvas(openId);
        await loadCanvasPromptTemplates();
        const nativeEditor=window.CanvasAssistantNative?.createEditor({
            getState:()=>({id:canvas?.id,kind:'classic',updatedAt:Number(canvas?.updated_at||0),nodes,connections,readOnly:!!canvas?.readOnly}),
            getSnapshot:()=>({nodes:serializableCanvasNodes(),connections}),
            save:()=>saveCanvasAssistantSnapshot(),pushUndo:()=>pushUndo(),render:()=>render(),clipModel:window.CanvasClipModel,setGroupMembers:setCanvasGroupMembers,setWorkflowParameters:setCanvasWorkflowParameters,
            exportWorkflow:typeof canvasAssistantExportWorkflow==='function'?canvasAssistantExportWorkflow:null,
            deliverMediaExport:async(node,results,destination)=>{
                if(destination==='download'){for(const r of results)await downloadUrl(r.url,r.name||'export.mp4');}
                else {const host=window.CanvasClipBridge?.forNode(node.id);if(!host||!host.output(node.id,results,host.getContext()))throw new Error('原生剪辑输出未接入画布');}
            },
            runNode:(node,options)=>node.type==='msgen'?runMsGenNode(node.id,options):node.type==='midjourney'?runMidjourneyNode(node.id,options):node.type==='comfy'?runComfyNode(node.id,options):node.type==='rh'?runRhNode(node.id,options):node.type==='video'?runVideoNode(node.id,options):runGenerator(node.id,options),
            runLLMNode:(node,options)=>runLLMNode(node.id,options),
            connectNodes:(from,to)=>{if(!canConnect(from,to)||wouldCreateGeneratorCycle(from,to))return false;if(!connections.some(c=>c.from===from&&c.to===to))connections.push({id:uid('c'),from,to});syncGeneratorInputs();refreshGeneratorInputViews();return true;},
            applyTask:(node,task,kind)=>{
                if(kind==='depth')return updateCanvasDepthCapture(canvasDepthPair(node),task,node.depthCapture.operationId);
                if(kind==='video'){
                    const id=task.task_id||task.id;
                    if(task.status==='succeeded')return completeCanvasVideoTask(id,task.result||task);
                    const found=findPendingTask(id);
                    if(!found)return false;
                    if(['failed','cancelled','canceled'].includes(task.status)){found.pending.failed=true;found.pending.error=task.error||'原视频任务未成功';refreshRunNodes(node,found.out);return true;}
                    return false;
                }
                if(kind==='comfy'){
                    const id=task.task_id||task.id;
                    if(task.status==='succeeded'){
                        if(!findPendingTask(id))return false;
                        completeCanvasComfyTask(id,task.result || task);
                        return !findPendingTask(id);
                    }
                    if(task.status==='failed'){
                        const found=findPendingTask(id);
                        if(!found)return false;
                        found.pending.error=task.error||'原生 ComfyUI 任务失败';
                        found.pending.failed=true;
                        refreshRunNodes(node,found.out);scheduleSave();
                        return true;
                    }
                    return false;
                }
                const id=task.task_id||task.id;
                if(task.status==='succeeded'){
                    const images=resultMediaUrls(task.image_items?.length?task.image_items:task).map(item=>kind==='video'?(typeof item==='string'?{url:item,kind:'video'}:{...item,kind:item.kind||'video'}):item);
                    if(!images.length)throw new Error('原任务成功但没有可回填的媒体结果');
                    const direct=(node._directPending||[]).filter(p=>p.canvasTaskId===id);
                    if(direct.length)materializeCanvasDirectTasks(node,direct);
                    if(!findPendingTask(id))return false;
                    completeCanvasImageTask(id,{...task,images});
                    return !findPendingTask(id);
                }else if(task.status==='failed'){
                    const direct=(node._directPending||[]).filter(p=>p.canvasTaskId===id);
                    if(direct.length)materializeCanvasDirectTasks(node,direct);
                    if(!findPendingTask(id))return false;
                    failCanvasImageTask(id,task.error||'原任务失败',task);
                }
            },
            applyFields:(node,patch)=>{if(node.type==='generator')setCanvasGeneratorSizeFields(node,patch);else if(node.type==='msgen')setCanvasMsSizeFields(node,patch);else Object.assign(node,patch);},
            createNode:type=>createNodeByType(type,defaultPoint(0,0)),
            shotHost:()=>window.CanvasVideoDeconstructionBridge,shotModel:window.CanvasVideoDeconstructionModel,
            check:proposal=>proposal.check(),
        });
        window.CanvasAssistant?.mount({
            kind:'classic',
            getContext:()=>canvas ? {id:canvas.id,title:canvas.title,updatedAt:Number(canvas.updated_at||0),nodes,selectedNodeIds:[...selected],creationSettings:canvasAssistantCreationSettings()} : null,
            save:()=>saveCanvasAssistantSnapshot(),
            refresh:()=>syncRemoteCanvasNow(),
            prepareImageRequest:canvasAssistantImageRequest,
            generateImage:canvasAssistantGenerateImage,
            nativeSnapshot:()=>nativeEditor?.snapshot(),
            executeNativeAction:proposal=>nativeEditor.execute(proposal),
            syncNativeTask:proposal=>nativeEditor.syncTask(proposal),
            referencePreview:(item,size)=>item.kind==='video' ? canvasVideoPreviewHtml(item.url,size,'preload="none"') : canvasPreviewImgHtml(item.thumbnail||item.url,size,'loading="lazy" draggable="false"'),
            bindReferencePreviews:element=>bindCanvasPreviewImageFallbacks(element),
            openPromptTemplates:async callback=>{canvasAssistantTemplateCallback=callback;await openPromptTemplateModal('');},
            addTextNode:async text=>{const node=addPromptNode(defaultPoint(0,0));if(!node)return false;node.text=String(text||'');render();scheduleSave();return true;},
            addImageNode:async (url,name,kind)=>{if(!url)return false;createImageCardFromUrl(url,defaultPoint(0,0),name||'助手图片',kind);return saveCanvas();},
            viewChanges:async ids=>{
                await syncRemoteCanvasNow();
                const affected=nodes.filter(node=>ids.includes(node.id));
                if(!affected.length)return false;
                selected=new Set(affected.map(node=>node.id));render();fitAllNodesViewport();return true;
            },
        });
    } else {
        window.location.replace(canvasListUrlForProject(rememberedCanvasListProject()));
    }
};
