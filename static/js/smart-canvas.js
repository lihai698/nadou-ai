const params = new URLSearchParams(location.search);
const canvasId = params.get('id') || '';
const sourceProjectId = params.get('project') || '';
const CANVAS_LIST_PROJECT_KEY = 'canvasListCurrentProjectId';
const shell = document.getElementById('shell');
const world = document.getElementById('world');
const composer = document.getElementById('composer');
const createMenu = document.getElementById('createMenu');
const promptInput = document.getElementById('promptInput');
const mentionPicker = document.getElementById('mentionPicker');
const mentionPreview = document.getElementById('mentionPreview');
const engineSelect = document.getElementById('engineSelect');
const dynamicParams = document.getElementById('dynamicParams');
const runBtn = document.getElementById('runBtn');
const cascadeRunBtn = document.getElementById('cascadeRunBtn');
const fileInput = document.getElementById('fileInput');
const apiKindToggle = document.getElementById('apiKindToggle');
const inputThumbsRow = document.getElementById('inputThumbsRow');
const SMART_UPLOAD_MAX = 20;
const SMART_UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024;
const SMART_UPLOAD_MAX_BATCH_BYTES = 500 * 1024 * 1024;
const SMART_REFERENCE_IMAGE_MAX = 20;






const inputPromptPreview = document.getElementById('inputPromptPreview');
const minimap = document.getElementById('minimap');
const minimapContent = document.getElementById('minimapContent');
const smartArrangeBtn = document.getElementById('smartArrangeBtn');
const clearCurrentCanvasBtn = document.getElementById('clearCurrentCanvasBtn');
const imageEditModal = document.getElementById('imageEditModal');
const smartLogModal = document.getElementById('smartLogModal');
const smartLogList = document.getElementById('smartLogList');
const smartShortcutModal = document.getElementById('smartShortcutModal');
const smartWorkflowToggle = document.getElementById('smartWorkflowToggle');
const smartWorkflowTransferModal = document.getElementById('smartWorkflowTransferModal');
const smartWorkflowTransferSub = document.getElementById('smartWorkflowTransferSub');
const smartWorkflowExportMeta = document.getElementById('smartWorkflowExportMeta');
const smartWorkflowImportInput = document.getElementById('smartWorkflowImportInput');
const smartWorkflowImportDropZone = document.getElementById('smartWorkflowImportDropZone');
const selectionBox = document.getElementById('selectionBox');
const assetToggle = document.getElementById('assetToggle');
const assetPanel = document.getElementById('assetPanel');
const assetCloseBtn = document.getElementById('assetCloseBtn');
const assetLibrarySelect = document.getElementById('assetLibrarySelect');
const assetCategorySelect = document.getElementById('assetCategorySelect');
const assetGrid = document.getElementById('assetGrid');
const assetDropZone = document.getElementById('assetDropZone');
const workflowEmpty = document.getElementById('workflowEmpty');
const assetImageControls = document.getElementById('assetImageControls');
const assetAddCategoryBtn = document.getElementById('assetAddCategoryBtn');
const assetRenameCategoryBtn = document.getElementById('assetRenameCategoryBtn');
const assetDialogBackdrop = document.getElementById('assetDialogBackdrop');
const assetDialogTitle = document.getElementById('assetDialogTitle');
const assetDialogInput = document.getElementById('assetDialogInput');
const assetDialogCancel = document.getElementById('assetDialogCancel');
const assetDialogOk = document.getElementById('assetDialogOk');
const assetHoverPreview = document.getElementById('assetHoverPreview');
const promptPresetPanel = document.getElementById('promptPresetPanel');
const promptPresetClose = document.getElementById('promptPresetClose');
const promptPresetStatus = document.getElementById('promptPresetStatus');
const promptPresetSelect = document.getElementById('promptPresetSelect');
const promptPresetName = document.getElementById('promptPresetName');
const promptPresetText = document.getElementById('promptPresetText');
const promptPresetApply = document.getElementById('promptPresetApply');
const promptPresetDelete = document.getElementById('promptPresetDelete');
const promptPresetNew = document.getElementById('promptPresetNew');
const promptPresetSave = document.getElementById('promptPresetSave');
const promptTemplatePanel = document.getElementById('promptTemplatePanel');
const promptTemplateClose = document.getElementById('promptTemplateClose');
const promptTemplateSearch = document.getElementById('promptTemplateSearch');
const promptTemplateLibrarySelect = document.getElementById('promptTemplateLibrarySelect');
const promptTemplateCats = document.getElementById('promptTemplateCats');
const promptTemplateBody = document.getElementById('promptTemplateBody');
const composerTemplateBtn = document.getElementById('composerTemplateBtn');
let minimapViewport = document.getElementById('minimapViewport');
let canvas = null;
let canvasUsesConnections = true;
let nodes = [];
let selectedId = '';
let selectedIds = [];
let selectedImage = {nodeId:'', index:-1};
let dragState = null;
let loopInsertPreview = null;
let selectionState = null;
let isRKeyDown = false;
let selectionJustFinished = false;
let resizeState = null;
let llmInstructionResizeState = null;
let promptSplitResizeState = null;
let thumbDragState = null;
let uploadTargetId = '';
let pendingGroupUploadPoint = null;
let mentionRange = null;
let mentionAnchorEl = null;
let mentionInsertMode = 'token';
let panState = null;
let didPan = false;
let portDragState = null;
let connectionEraseState = null;
const smartSaveScheduler = CanvasSaveScheduler.create({save:()=>saveCanvas(),getCanvasId:()=>canvasId});
let apiProviders = [];
let comfyWorkflows = [];
let comfyInstanceCount = 1;
let assetLibrary = {categories:[]};
let assetLibraryOpen = false;
let assetTab = 'image';
let activeAssetCategoryId = '';
let activeAssetLibraryId = '';
let activeWorkflowAssetCategoryId = '';
const LOCAL_ASSET_LIBRARY_ID = '__local_assets__';
let localAssetLibrary = {items:[], tree:null};
let activeLocalAssetFolderId = '__root__';
let mentionSource = 'input';
let mentionAssetCategoryId = '';
let assetLibraryUpdatedAt = 0;
let assetLibraryRefreshTimer = null;
let activeAssetSmartClassId = '';
const ASSET_SMART_CATEGORY_PREFIX = '__smart_class__::';
const PROMPT_PRESETS_KEY = 'smart_canvas_prompt_presets_v1';
const PROMPT_TEMPLATE_GROUPS_KEY = 'smart_canvas_prompt_template_groups_v1';
const PROMPT_TEMPLATE_OVERRIDES_KEY = 'smart_canvas_prompt_template_overrides_v1';
const SMART_UNSAVED_ACCEPTED_TASKS_PREFIX = 'smart_canvas_unsaved_accepted_tasks:';
let promptPresets = [];
let canvasAssistantTemplateCallback = null;
let builtinPromptTemplates = [];
let promptLibraries = [];
let activePromptLibraryId = 'system';
let promptTemplateGroups = [];
let promptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};
let promptTemplateCategory = 'all';
let promptTemplateSelectedId = '';
let promptTemplateEditing = false;
let promptTemplateGroupEditMode = false;
let promptPresetDeleteArmed = false;
let createMenuPoint = {x:0, y:0};
let createMenuGroupId = '';
let nodeClipboard = null;
let imageClickTimer = null;
let suppressImageClickUntil = 0;
let lastMouseWorld = null;
let lastConfigRefreshAt = 0;
let smartMinimapState = null;
let smartMinimapDrag = false;
let zoomPreviewState = null;
let runTimerInterval = null;
let smartCascadeRunning = false;
let smartCascadeActiveLoopId = '';
let smartCascadeStopRequested = false;
let smartCascadeSilentSelection = false;
let smartCascadeRunPath = null;
const smartCascadeRuns = new Map();
let smartLoopContext = null;
let transientSmartCloudLinks = [];
const activeSmartTaskPolls = new Map();
const activeSmartComfyTaskPolls = new Set();
let smartRhRandomValues = {};
let lastImagePasteAt = 0;
let lastNodePasteAt = 0;
let suppressNodeClickUntil = 0;
const smartTextSelection = CanvasTextSelection.create();
const UNDO_LIMIT = 40;
const undoStack = [];
const redoStack = [];
let redoBaseContent = '';
let undoSuppressed = false;
let pendingUndoSnapshot = null;
let runningHubWorkflowCache = {};
function smartCascadeHost(){
    return {
        get MEDIA_GROUP_DEFAULT_SCALE(){return MEDIA_GROUP_DEFAULT_SCALE;},
        get MEDIA_NODE_DEFAULT_SCALE(){return MEDIA_NODE_DEFAULT_SCALE;},
        get activeComposerSubject(){return activeComposerSubject;},
        set activeComposerSubject(value){activeComposerSubject=value;},
        get apiProviders(){return apiProviders;},
        get cascadeRunBtn(){return cascadeRunBtn;},
        get comfyInstanceCount(){return comfyInstanceCount;},
        get composer(){return composer;},
        get lastComposerNodeId(){return lastComposerNodeId;},
        set lastComposerNodeId(value){lastComposerNodeId=value;},
        get nodes(){return nodes;},
        get promptInput(){return promptInput;},
        get runBtn(){return runBtn;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get settings(){return settings;},
        set settings(value){settings=value;},
        get smartCascadeActiveLoopId(){return smartCascadeActiveLoopId;},
        set smartCascadeActiveLoopId(value){smartCascadeActiveLoopId=value;},
        get smartCascadeRunPath(){return smartCascadeRunPath;},
        set smartCascadeRunPath(value){smartCascadeRunPath=value;},
        get smartCascadeRunning(){return smartCascadeRunning;},
        set smartCascadeRunning(value){smartCascadeRunning=value;},
        get smartCascadeRuns(){return smartCascadeRuns;},
        get smartCascadeSilentSelection(){return smartCascadeSilentSelection;},
        set smartCascadeSilentSelection(value){smartCascadeSilentSelection=value;},
        get smartCascadeStopRequested(){return smartCascadeStopRequested;},
        set smartCascadeStopRequested(value){smartCascadeStopRequested=value;},
        get smartLoopContext(){return smartLoopContext;},
        set smartLoopContext(value){smartLoopContext=value;},
        get window(){return window;},
        addSmartGenerationLog:(...args)=>addSmartGenerationLog(...args),
        appendCascadeRefsToReceiver:(...args)=>appendCascadeRefsToReceiver(...args),
        appendLoopOutputsToNode:(...args)=>appendLoopOutputsToNode(...args),
        attachRunMeta:(...args)=>attachRunMeta(...args),
        buildPromptRequestForNode:(...args)=>buildPromptRequestForNode(...args),
        canRunSmartCascade:(...args)=>canRunSmartCascade(...args),
        cascadeRefsFromOutputs:(...args)=>cascadeRefsFromOutputs(...args),
        cascadeTailForLoop:(...args)=>cascadeTailForLoop(...args),
        cleanHistoryImages:(...args)=>cleanHistoryImages(...args),
        clearSourceBusyStateIfDownstreamDone:(...args)=>clearSourceBusyStateIfDownstreamDone(...args),
        cloneSmartSettings:(...args)=>cloneSmartSettings(...args),
        copyMediaSizeFields:(...args)=>copyMediaSizeFields(...args),
        createLoopOutputSlot:(...args)=>createLoopOutputSlot(...args),
        defaultReferenceImagesFor:(...args)=>defaultReferenceImagesFor(...args),
        ensureHistoryGroupForNode:(...args)=>ensureHistoryGroupForNode(...args),
        finishLoopTargetPreviewState:(...args)=>finishLoopTargetPreviewState(...args),
        generateUrlsForCurrentSettings:(...args)=>generateUrlsForCurrentSettings(...args),
        handleJimengPendingSignal:(...args)=>handleJimengPendingSignal(...args),
        isApiLikeEngine:(...args)=>isApiLikeEngine(...args),
        isDirectLoopTargetRun:(...args)=>isDirectLoopTargetRun(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        isVideoMediaItem:(...args)=>isVideoMediaItem(...args),
        liveSmartNode:(...args)=>liveSmartNode(...args),
        loopOutputSlotForRound:(...args)=>loopOutputSlotForRound(...args),
        markSmartNodeComplete:(...args)=>markSmartNodeComplete(...args),
        mediaKindForUrls:(...args)=>mediaKindForUrls(...args),
        nonPreviewOutputImages:(...args)=>nonPreviewOutputImages(...args),
        nowMs:(...args)=>nowMs(...args),
        outputImagesForNode:(...args)=>outputImagesForNode(...args),
        pushUndo:(...args)=>pushUndo(...args),
        recordSmartTaskSubmission:(...args)=>recordSmartTaskSubmission(...args),
        refsForDirectLoopRound:(...args)=>refsForDirectLoopRound(...args),
        relayLoopPromptNodesForEdge:(...args)=>relayLoopPromptNodesForEdge(...args),
        relayLoopPromptNodesForTarget:(...args)=>relayLoopPromptNodesForTarget(...args),
        rememberRecentSmartSettings:(...args)=>rememberRecentSmartSettings(...args),
        rememberRoundOutputs:(...args)=>rememberRoundOutputs(...args),
        render:(...args)=>render(...args),
        replaceOutputsToNodeWithHistory:(...args)=>replaceOutputsToNodeWithHistory(...args),
        requestSmartCascadeStop:(...args)=>requestSmartCascadeStop(...args),
        resolveSmartCascadeLoop:(...args)=>resolveSmartCascadeLoop(...args),
        resumeSmartPendingNode:(...args)=>resumeSmartPendingNode(...args),
        get retainSmartVideoTaskRecovery(){return typeof retainSmartVideoTaskRecovery==='function' ? (...args)=>retainSmartVideoTaskRecovery(...args) : undefined;},
        runApiGeneration:(...args)=>runApiGeneration(...args),
        runCascadeStepIntoNode:(...args)=>runCascadeStepIntoNode(...args),
        runLoopRoundIntoSlot:(...args)=>runLoopRoundIntoSlot(...args),
        savePromptDraftForCurrent:(...args)=>savePromptDraftForCurrent(...args),
        saveSmartAcceptedTasksBeforeQuery:(...args)=>saveSmartAcceptedTasksBeforeQuery(...args),
        scheduleConnectionLayerRefresh:(...args)=>scheduleConnectionLayerRefresh(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedNode:(...args)=>selectedNode(...args),
        selfReferenceImagesForNode:(...args)=>selfReferenceImagesForNode(...args),
        showDirectLoopRoundPreview:(...args)=>showDirectLoopRoundPreview(...args),
        smartApiAudioMode:(...args)=>smartApiAudioMode(...args),
        smartAudioSources:(...args)=>smartAudioSources(...args),
        smartCascadeAnyRunning:(...args)=>smartCascadeAnyRunning(...args),
        smartCascadeGraphForTail:(...args)=>smartCascadeGraphForTail(...args),
        smartCascadeIsLoopRunning:(...args)=>smartCascadeIsLoopRunning(...args),
        smartCascadePathForCtx:(...args)=>smartCascadePathForCtx(...args),
        smartHasAudioAnalysisInput:(...args)=>smartHasAudioAnalysisInput(...args),
        smartLoopRoundSettings:(...args)=>smartLoopRoundSettings(...args),
        smartPendingTasks:(...args)=>smartPendingTasks(...args),
        smartRecoverableImageTask:(...args)=>smartRecoverableImageTask(...args),
        smartRunNeedsPrompt:(...args)=>smartRunNeedsPrompt(...args),
        smartRunSnapshot:(...args)=>smartRunSnapshot(...args),
        smartSettingsForNode:(...args)=>smartSettingsForNode(...args),
        smartUnknownResubmissionNotice:(...args)=>smartUnknownResubmissionNotice(...args),
        smartUnknownSubmissionForNode:(...args)=>smartUnknownSubmissionForNode(...args),
        stripImageGenerationMeta:(...args)=>stripImageGenerationMeta(...args),
        syncRunButtonState:(...args)=>syncRunButtonState(...args),
        syncSmartCascadeLegacyState:(...args)=>syncSmartCascadeLegacyState(...args),
        tagLoopOutputSlot:(...args)=>tagLoopOutputSlot(...args),
        throwIfSmartCascadeStopRequested:(...args)=>throwIfSmartCascadeStopRequested(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        trf:(...args)=>trf(...args),
        updateComposer:(...args)=>updateComposer(...args),
        upstreamLoopPromptNodesFor:(...args)=>upstreamLoopPromptNodesFor(...args),
        validOutpaintSize:(...args)=>validOutpaintSize(...args)
    };
}
function activeSmartCascadeCount(){
    return SmartCascadeState.activeSmartCascadeCount(smartCascadeHost());
}
function smartCascadeRunForLoop(loopId){
    return SmartCascadeState.smartCascadeRunForLoop(smartCascadeHost(), loopId);
}
function smartCascadeIsLoopRunning(loopId){
    return SmartCascadeState.smartCascadeIsLoopRunning(smartCascadeHost(), loopId);
}
function syncSmartCascadeLegacyState(preferredLoopId=''){
    return SmartCascadeState.syncSmartCascadeLegacyState(smartCascadeHost(), preferredLoopId);
}
function smartCascadeAnyRunning(){
    return SmartCascadeState.smartCascadeAnyRunning(smartCascadeHost());
}
function smartCascadeEdgeState(edgeKey){
    return SmartCascadeState.smartCascadeEdgeState(smartCascadeHost(), edgeKey);
}
function smartCascadePathForCtx(ctx=null){
    return SmartCascadeState.smartCascadePathForCtx(smartCascadeHost(), ctx);
}
function capturePendingUndo(){ pendingUndoSnapshot = snapshotForUndo(); }
function commitPendingUndo(){
    if(pendingUndoSnapshot){
        redoStack.length = 0;
        redoBaseContent = '';
        undoStack.push(pendingUndoSnapshot);
        if(undoStack.length > UNDO_LIMIT) undoStack.shift();
        pendingUndoSnapshot = null;
    }
}
function discardPendingUndo(){ pendingUndoSnapshot = null; }
function snapshotForUndo(){
    return {
        nodes: JSON.parse(JSON.stringify(nodes)),
        connections: JSON.parse(JSON.stringify(canvas?.connections || [])),
        selectedId,
        selectedIds: selectedIds.slice(),
        selectedImage: {...selectedImage}
    };
}
function pushUndo(){
    if(undoSuppressed) return;
    if(!canvas) return;
    redoStack.length = 0;
    redoBaseContent = '';
    undoStack.push(snapshotForUndo());
    if(undoStack.length > UNDO_LIMIT) undoStack.shift();
}
function restoreHistorySnapshot(snap){
    invalidateSmartVideoDeconstruction();
    undoSuppressed = true;
    try {
        discardPendingUndo();
        nodes = snap.nodes;
        if(canvas) canvas.connections = snap.connections;
        selectedId = snap.selectedId;
        selectedIds = snap.selectedIds;
        selectedImage = snap.selectedImage;
        activeComposerSubject = null;
        lastComposerNodeId = '';
        render();
        redoBaseContent = redoStack.length ? historyContentSignature() : '';
        scheduleSave();
    } finally {
        undoSuppressed = false;
    }
}
function historyContentSignature(){
    return JSON.stringify({nodes, connections: canvas?.connections || []});
}
function performUndo(){
    if(!undoStack.length){ toast(tr('smart.toastNoUndo')); return; }
    redoStack.push(snapshotForUndo());
    if(redoStack.length > UNDO_LIMIT) redoStack.shift();
    restoreHistorySnapshot(undoStack.pop());
    toast(tr('smart.toastUndone'));
}
function performRedo(){
    if(!redoStack.length){ toast(tr('smart.toastNoRedo')); return; }
    undoStack.push(snapshotForUndo());
    if(undoStack.length > UNDO_LIMIT) undoStack.shift();
    restoreHistorySnapshot(redoStack.pop());
    toast(tr('smart.toastRedone'));
}
let comfyWorkflowCache = {};
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
let gridCustomLines = [];
let gridCustomOrientation = 'h';
let gridCustomHistory = [];
let gridCustomDrag = null;
let gridOperationMode = 'split';
let gridJoinLayout = null;
let gridJoinDrag = null;
let gridJoinImageCache = new Map();
let gridJoinUserMoved = false;
let gridJoinOutputSize = 2048;
// 非空时表示当前宫格拼接的数据源是整个分组（聚合组内所有图片成员），而不是单个节点。
let gridJoinGroupId = '';
let imageEditZoom = 1.0;
let imageEditBaseW = 0;
let imageEditBaseH = 0;
let previewZoom = 1.0;
let previewPan = {x:0, y:0};
let previewPanDrag = null;
let previewCompareDrag = false;
let previewComparePos = 50;
let imageEditPanDrag = null;
let previewNavState = {nodeId:'', index:0, count:0};
const PANORAMA_RATIO_PRESETS = {
    square:{w:1, h:1},
    portrait:{w:2, h:3},
    landscape:{w:3, h:2},
    portrait43:{w:3, h:4},
    landscape43:{w:4, h:3},
    story:{w:9, h:16},
    wide:{w:16, h:9},
    ultrawide:{w:21, h:9},
    ultratall:{w:9, h:21}
};
let panoramaState = {
    enabled:false,
    ratio:'wide',
    customW:16,
    customH:9,
    fov:75,
    yaw:0,
    pitch:0,
    drag:null,
    three:null,
    renderer:null,
    scene:null,
    camera:null,
    sphere:null,
    texture:null,
    threeLoadPromise:null,
    image:null,
    ctx:null,
    animationId:0,
    loadedSrc:'',
    loadToken:0
};
window.__smartCanvasPanoramaState = panoramaState;
let viewport = {x:0, y:0, scale:1};
let settings = {
    engine:'api',
    apiKind:'image',
    provider_id:'',
    model:'',
    ratio:'square',
    resolution:'4k',
    customRatio:'',
    customRatioWidth:'',
    customRatioHeight:'',
    customSize:'',
    customWidth:'',
    customHeight:'',
    quality:'auto',
    count:1,
    videoProvider:'',
    videoModel:'',
    videoDuration:5,
    videoAspect:'16:9',
    videoResolution:'',
    videoEnhancePrompt:false,
    videoEnableUpsample:false,
    videoWatermark:false,
    videoCameraFixed:false,
    videoGenerateAudio:false,
    videoMultimodal:true,
    _videoMultimodalUserSet:false,
    videoUseFrameRoles:false,
    videoTrustedAsset:false,
    videoTrustedSource:'library',
    videoTempShLinks:[],
    msgenModel:'zimage',
    msCustomModel:'',
    msRatio:'square',
    msResolution:'1k',
    msCustomRatio:'',
    msCustomRatioWidth:'',
    msCustomRatioHeight:'',
    msCustomSize:'',
    msCustomWidth:'',
    msCustomHeight:'',
    comfyMode:'text',
    comfyWorkflow:'',
    comfyParams:{},
    rhConfigKey:'',
    rhPayment:'free',
    rhInstanceType:'',
    rhParams:{},
    rhRandomActive:{},
    width:1024,
    height:1024,
    enhanceStrength:0.5,
    enhanceUpscale:false,
    enhanceUpscaleRes:2048,
    editUpscale:false,
    editUpscaleRes:2048,
    jimengUpscaleRes:'2k',
    promptH:124
};
const MS_GEN_MODELS = {
    zimage: { label:'ZImage', modelId:'Tongyi-MAI/Z-Image-Turbo', supportsImage:false, endpoint:'/generate' },
    qwen_edit: { label:'Qwen Edit', modelId:'Qwen/Qwen-Image-Edit-2511', supportsImage:true, endpoint:'/api/angle/generate' },
    klein_edit: { label:'Klein', modelId:'black-forest-labs/FLUX.2-klein-9B', supportsImage:true, endpoint:'/api/ms/generate' },
    custom: { label:tr('smart.custom') || '自定义', modelId:'', acceptsImage:true, endpoint:'/api/ms/generate' }
};
const SIZE_MAP = CanvasImageParams.SIZE_MAP;
const API_RATIO_VALUES = CanvasImageParams.API_RATIO_VALUES;
const RES_LONG_SIDE = CanvasImageParams.RES_LONG_SIDE;
const RES_PIXEL_LIMIT = CanvasImageParams.RES_PIXEL_LIMIT;
function tr(key){ return window.StudioI18n?.t ? window.StudioI18n.t(key) : key; }
function trf(key, values={}){
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), tr(key));
}
function copyTextWithCopyEvent(value){
    let handled = false;
    const onCopy = event => {
        event.preventDefault();
        event.clipboardData?.setData('text/plain', value);
        handled = true;
    };
    document.addEventListener('copy', onCopy);
    try {
        return document.execCommand('copy') && handled;
    } catch(_) {
        return false;
    } finally {
        document.removeEventListener('copy', onCopy);
    }
}
function copyTextWithTextarea(value){
    let ta = null;
    try {
        ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus({preventScroll:true});
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        return document.execCommand('copy');
    } catch(_) {
        return false;
    } finally {
        ta?.remove();
    }
}
async function clipboardMatchesText(value){
    try {
        if(navigator.clipboard?.readText && window.isSecureContext){
            return (await navigator.clipboard.readText()) === value;
        }
    } catch(_) {}
    return null;
}
async function copyTextToClipboard(text){
    const value = String(text || '');
    if(!value) return false;
    if(copyTextWithCopyEvent(value) || copyTextWithTextarea(value)){
        const verified = await clipboardMatchesText(value);
        return verified !== false;
    }
    try {
        if(navigator.clipboard?.writeText && window.isSecureContext !== false){
            await navigator.clipboard.writeText(value);
            const verified = await clipboardMatchesText(value);
            return verified !== false;
        }
    } catch(_) {}
    return false;
}
function refreshIcons(){ if(window.lucide) lucide.createIcons(); }
function uid(prefix){ return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`; }
function escapeHtml(str){ return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
const escapeAttr = escapeHtml;
function smartMediaSourceHost(){
    return {
        get URL(){return URL;},
        get window(){return window;},
        smartOriginalMediaUrl:(...args)=>smartOriginalMediaUrl(...args),
        fileNameFromUrl:(...args)=>fileNameFromUrl(...args),
        proxiedMediaUrl:(...args)=>proxiedMediaUrl(...args),
        displayMediaUrl:(...args)=>displayMediaUrl(...args),
        smartMediaPreviewUrl:(...args)=>smartMediaPreviewUrl(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        escapeAttr:(...args)=>escapeAttr(...args)
    };
}
function smartOriginalMediaUrl(itemOrUrl){
    return CanvasMediaSources.smartOriginalMediaUrl(smartMediaSourceHost(), itemOrUrl);
}
function smartMediaPreviewUrl(itemOrUrl, size=512){
    return CanvasMediaSources.smartMediaPreviewUrl(smartMediaSourceHost(), itemOrUrl, size);
}
function smartPreviewImgHtml(itemOrUrl, size=512, attrs=''){
    return CanvasMediaSources.smartPreviewImgHtml(smartMediaSourceHost(), itemOrUrl, size, attrs);
}
function smartImageDimensionsHost(){
    return {
        get nodes(){return nodes;},
        get world(){return world;},
        get Image(){return Image;},
        get window(){return window;},
        captureCanvasContext:()=>smartMediaInputController.capture(),
        displayMediaUrl:(...args)=>displayMediaUrl(...args),
        smartOriginalMediaUrl:(...args)=>smartOriginalMediaUrl(...args),
        bindImageProxyFallback:(...args)=>bindImageProxyFallback(...args),
        isSmartPreviewImage:(...args)=>isSmartPreviewImage(...args),
        applyThumbDisplaySizeToElement:(...args)=>applyThumbDisplaySizeToElement(...args),
        updateImageResolutionBadgeElement:(...args)=>updateImageResolutionBadgeElement(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        singleImageLayout:(...args)=>singleImageLayout(...args),
        mediaNodeDefaultScale:(...args)=>mediaNodeDefaultScale(...args),
        updateNodeElementDuringResize:(...args)=>updateNodeElementDuringResize(...args),
        isNodeSelected:(...args)=>isNodeSelected(...args),
        updateComposer:(...args)=>updateComposer(...args),
        scheduleSave:(...args)=>scheduleSave(...args)
    };
}
const smartImageDimensions=SmartImageDimensions.create(smartImageDimensionsHost);
function smartVideoPreviewHtml(itemOrUrl, size=512, attrs=''){
    return CanvasMediaSources.smartVideoPreviewHtml(smartMediaSourceHost(), itemOrUrl, size, attrs);
}
function smartVideoFallbackHtml(url, attrs=''){
    return CanvasMediaSources.smartVideoFallbackHtml(smartMediaSourceHost(), url, attrs);
}
function smartVideoPlayerHtml(url, attrs=''){
    return CanvasMediaSources.smartVideoPlayerHtml(smartMediaSourceHost(), url, attrs);
}

function smartPreviewEventsHost(){
    return {
        get document(){return document;},
        get window(){return window;},
        get nodes(){return nodes;},
        captureCanvasContext:()=>smartMediaInputController.capture(),
        smartOriginalMediaUrl:(...args)=>smartOriginalMediaUrl(...args),
        imageForDisplay:(...args)=>imageForDisplay(...args),
        smartVideoPlayerHtml:(...args)=>smartVideoPlayerHtml(...args),
        smartVideoFallbackHtml:(...args)=>smartVideoFallbackHtml(...args)
    };
}
const smartPreviewEvents=SmartPreviewEvents.create(smartPreviewEventsHost);
function smartActivateVideoPreview(target){
    return smartPreviewEvents.activate(target);
}
function isSmartPreviewImage(img){
    return img?.tagName?.toLowerCase?.() === 'img'
        && img.dataset?.previewSrc
        && img.dataset?.originalSrc
        && img.dataset.previewSrc !== img.dataset.originalSrc
        && img.getAttribute('src') !== img.dataset.originalSrc;
}
function bindSmartPreviewImageFallbacks(root=document){
    return smartPreviewEvents.bind(root);
}
function smartImageResolutionHost(){
    return {
        get nodes(){return nodes;},
        get world(){return world;},
        get shell(){return shell;},
        get viewport(){return viewport;},
        get imageEditModal(){return imageEditModal;},
        get Image(){return Image;},
        get window(){return window;},
        captureCanvasContext:()=>smartMediaInputController.capture(),
        displayMediaUrl:(...args)=>displayMediaUrl(...args),
        smartOriginalMediaUrl:(...args)=>smartOriginalMediaUrl(...args),
        proxiedMediaUrl:(...args)=>proxiedMediaUrl(...args),
        setTimeout:(...args)=>setTimeout(...args),
        clearTimeout:(...args)=>clearTimeout(...args)
    };
}
const smartImageResolution=SmartImageResolution.create(smartImageResolutionHost);
function syncSmartSelectedImageResolution(root=null){
    return smartImageResolution.sync(root);
}
function scheduleSmartImageResolutionSync(root=world, delay=120){
    return smartImageResolution.schedule(root,delay);
}
function smartNodeElementsByIds(ids){
    const wanted = ids instanceof Set ? ids : new Set(ids || []);
    const elements = [];
    if(!wanted.size) return elements;
    world.querySelectorAll?.('.image-node').forEach(el => {
        const id = el.dataset?.id || '';
        if(wanted.has(id)) elements.push(el);
    });
    return elements;
}
function cloneSmartSettings(source=settings){
    try {
        return JSON.parse(JSON.stringify(source || {}));
    } catch(e) {
        return {...(source || {})};
    }
}
function settingsForStorage(source=settings){
    const clean = cloneSmartSettings(source);
    clean.videoTempShLinks = (clean.videoTempShLinks || []).filter(item => item?.manual === true);
    return clean;
}
function normalizeSmartVideoModeSettings(target, preferMultimodal=false){
    return SmartNodeParams.normalizeSmartVideoModeSettings(smartNodeParamsHost(), target, preferMultimodal);
}
function isApiLikeEngine(engine){
    return SmartNodeParams.isApiLikeEngine(smartNodeParamsHost(), engine);
}
function smartLoopRoundSettings(runSettings, ctx=smartLoopContext){
    return SmartNodeParams.smartLoopRoundSettings(smartNodeParamsHost(), runSettings, ctx);
}
function smartNodeParamsHost(){
    return {
        get settings(){return settings;},
        get smartLoopContext(){return smartLoopContext;},
        apiImageSize:(...args)=>apiImageSize(...args),
        isGptImageAutoSizeModel:(...args)=>isGptImageAutoSizeModel(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        parseRatioValue:(...args)=>parseRatioValue(...args),
        parseSizeValue:(...args)=>parseSizeValue(...args),
        stripImageGenerationMeta:(...args)=>stripImageGenerationMeta(...args),
        tr:(...args)=>tr(...args)
    };
}
function isGptImageAutoSizeModel(model){
    return CanvasImageParams.isGptImageAutoSizeModel(smartNodeParamsHost(), model);
}
function defaultSmartApiResolution(model){
    return SmartNodeParams.defaultSmartApiResolution(smartNodeParamsHost(), model);
}
function mediaItemForStorage(item){
    if(!item || typeof item !== 'object') return item;
    const clean = {...item};
    delete clean.cloudUrl;
    delete clean.uploadedUrl;
    delete clean.originalRemoteUrl;
    delete clean.tempCloudUrl;
    delete clean._inlineVideoActive;
    return clean;
}
function canvasForStorage(){
    const clean = JSON.parse(JSON.stringify(canvas || {}));
    clean.settings = settingsForStorage(canvasDefaultSmartSettings || initialSmartSettings);
    // 日志预览的临时节点（编辑器打开期间临时塞进 nodes）绝不能被持久化，否则刷新后会留下幽灵节点。
    if(Array.isArray(clean.nodes)) clean.nodes = clean.nodes.filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID);
    (clean.nodes || []).forEach(node => {
        if(Array.isArray(node.images)) node.images = node.images.map(mediaItemForStorage);
        if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);

    });
    return clean;
}
function apiErrorMessage(data, fallback='请求失败'){
    if(!data) return fallback;
    if(typeof data === 'string') return data || fallback;
    const detail = data.detail ?? data.error ?? data.message;
    if(typeof detail === 'string') return detail || fallback;
    if(Array.isArray(detail)){
        const messages = detail.map(item => {
            if(typeof item === 'string') return item;
            const loc = Array.isArray(item?.loc) ? item.loc.filter(x => x !== 'body').join('.') : '';
            const msg = item?.msg || item?.message || JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
        }).filter(Boolean);
        return messages.join('\n') || fallback;
    }
    if(detail && typeof detail === 'object') return detail.message || detail.msg || JSON.stringify(detail);
    try {
        return JSON.stringify(data);
    } catch(e) {
        return fallback;
    }
}
async function responseErrorMessage(response, fallback='请求失败'){
    try {
        const data = await response.clone().json();
        return apiErrorMessage(data, fallback);
    } catch(e) {
        try {
            const text = await response.text();
            return text || fallback;
        } catch(_) {
            return fallback;
        }
    }
}
function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'smart-canvas-workflow.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
}
function smartWorkflowTransferHost(){
    return {
        captureMediaInputContext:()=>smartMediaInputController.capture(),
        get activeComposerSubject(){return activeComposerSubject;},
        set activeComposerSubject(value){activeComposerSubject=value;},
        get canvas(){return canvas;},
        get document(){return document;},
        get nodes(){return nodes;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get smartWorkflowExportMeta(){return smartWorkflowExportMeta;},
        get smartWorkflowImportDropZone(){return smartWorkflowImportDropZone;},
        get smartWorkflowToggle(){return smartWorkflowToggle;},
        get smartWorkflowTransferModal(){return smartWorkflowTransferModal;},
        get smartWorkflowTransferSub(){return smartWorkflowTransferSub;},
        canvasForStorage:(...args)=>canvasForStorage(...args),
        downloadBlob:(...args)=>downloadBlob(...args),
        fetch:(...args)=>fetch(...args),
        normalizeLegacySmartNode:(...args)=>normalizeLegacySmartNode(...args),
        pushUndo:(...args)=>pushUndo(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        remapSmartDepthCopies:(...args)=>remapSmartDepthCopies(...args),
        remapSmartViewAdjustRefs:(...args)=>remapSmartViewAdjustRefs(...args),
        render:(...args)=>render(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedNodeIds:(...args)=>selectedNodeIds(...args),
        serializableSmartNode:(...args)=>serializableSmartNode(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartNodesWithGroupMembers:(...args)=>smartNodesWithGroupMembers(...args),
        toast:(...args)=>toast(...args),
        toggleAssetLibrary:(...args)=>toggleAssetLibrary(...args),
        uid:(...args)=>uid(...args),
        viewportCenter:(...args)=>viewportCenter(...args)
    };
}
async function smartCanvasAssistantExportWorkflow({actionId,nodeId,nodeIds,connectionIds,includeResources,scopeHash,beforeDownload}){
    return SmartWorkflowTransfer.smartCanvasAssistantExportWorkflow(smartWorkflowTransferHost(), {actionId,nodeId,nodeIds,connectionIds,includeResources,scopeHash,beforeDownload});
}
function smartWorkflowFilename(ext='json'){
    return SmartWorkflowTransfer.smartWorkflowFilename(smartWorkflowTransferHost(), ext);
}
function clearSmartNodeTransientRunState(node, options={}){
    if(!node) return node;
    node.running = false;
    node.pending = 0;
    node.queued = false;
    delete node.jimengPending;
    delete node.pendingTasks;
    delete node._runMetaTargetId;
    if(options.clearRunHistory){
        delete node.runStartedAt;
        delete node.runFinishedAt;
        delete node.runElapsedMs;
        delete node.runTimerHidden;
    }
    return node;
}
function serializableSmartNode(node){
    const base = JSON.parse(JSON.stringify(node || {}));
    const copy = normalizeLegacySmartNode(base) || {};
    if(Array.isArray(copy.images)) copy.images = copy.images.map(img => mediaItemForStorage(stripImageGenerationMeta(img))).filter(Boolean);
    if(copy.runSettings) copy.runSettings = settingsForStorage(copy.runSettings);
    clearSmartNodeTransientRunState(copy);
    window.CanvasAudio.detachTask(copy);
    delete copy._dom;
    return copy;
}
function selectedSmartWorkflowPayload(){
    return SmartWorkflowTransfer.selectedSmartWorkflowPayload(smartWorkflowTransferHost());
}
function normalizeImportedSmartWorkflow(data){
    return SmartWorkflowTransfer.normalizeImportedSmartWorkflow(smartWorkflowTransferHost(), data);
}
function importedSmartLocalAssetUrls(value, urls=new Set()){
    return SmartWorkflowTransfer.importedSmartLocalAssetUrls(smartWorkflowTransferHost(), value, urls);
}
function openSmartWorkflowTransferModal(){
    return SmartWorkflowTransfer.openSmartWorkflowTransferModal(smartWorkflowTransferHost());
}
function closeSmartWorkflowTransferModal(){
    return SmartWorkflowTransfer.closeSmartWorkflowTransferModal(smartWorkflowTransferHost());
}
function updateSmartWorkflowTransferMeta(){
    return SmartWorkflowTransfer.updateSmartWorkflowTransferMeta(smartWorkflowTransferHost());
}
async function exportSelectedSmartWorkflow(includeResources=false){
    return SmartWorkflowTransfer.exportSelectedSmartWorkflow(smartWorkflowTransferHost(), includeResources);
}
function insertSmartWorkflowIntoCanvas(imported){
    return SmartWorkflowTransfer.insertSmartWorkflowIntoCanvas(smartWorkflowTransferHost(), imported);
}
async function importSmartWorkflowFile(file){
    return SmartWorkflowTransfer.importSmartWorkflowFile(smartWorkflowTransferHost(), file);
}
const RECENT_SMART_SETTINGS_KEY = 'smart_canvas_recent_run_settings_v1';
const initialSmartSettings = cloneSmartSettings(settings);
let canvasDefaultSmartSettings = cloneSmartSettings(settings);
let recentSmartSettingsByMode = {};
function smartSettingsModeKey(source=settings){
    const engine = ['api','volcengine','modelscope','comfy','runninghub'].includes(source?.engine) ? source.engine : 'api';
    if(engine === 'api') return `api:${source?.apiKind === 'video' ? 'video' : 'image'}`;
    if(engine === 'volcengine') return `volcengine:${source?.apiKind === 'video' ? 'video' : 'image'}`;
    if(engine === 'comfy') return `comfy:${['text','enhance','edit','custom'].includes(source?.comfyMode) ? source.comfyMode : 'text'}`;
    if(engine === 'runninghub') return 'runninghub';
    return 'modelscope';
}
function loadRecentSmartSettings(){
    try {
        const data = JSON.parse(localStorage.getItem(RECENT_SMART_SETTINGS_KEY) || '{}');
        recentSmartSettingsByMode = data && typeof data === 'object' ? data : {};
    } catch(e) {
        recentSmartSettingsByMode = {};
    }
}
function saveRecentSmartSettings(){
    localStorage.setItem(RECENT_SMART_SETTINGS_KEY, JSON.stringify(recentSmartSettingsByMode));
}
function recentSmartSettingsForMode(modeKey=''){
    const key = modeKey || recentSmartSettingsByMode.__lastKey || smartSettingsModeKey(settings);
    const saved = recentSmartSettingsByMode[key];
    return saved && typeof saved === 'object' ? cloneSmartSettings(saved) : {};
}
function rememberRecentSmartSettings(source=settings, node=null){
    // 音频分析使用当前节点的文本模型选择，不应覆盖图片模式的最近配置。
    if(smartApiAudioMode(node,source) || smartHasAudioAnalysisInput(node))return;
    const clean = stripOutpaintDisplaySettings(settingsForStorage(source), node);
    sanitizeSmartApiSelection(clean);
    if(clean.outpaintResolutionLocked === true && clean.resolution === 'custom'){
        clean.resolution = '1k';
        clean.ratio = clean.ratio || 'square';
        clean.customWidth = '';
        clean.customHeight = '';
        clean.customSize = '';
    }
    delete clean.outpaintResolutionLocked;
    const key = smartSettingsModeKey(clean);
    recentSmartSettingsByMode[key] = settingsForStorage(clean);
    recentSmartSettingsByMode.__lastKey = key;
    saveRecentSmartSettings();
}
function applyRecentSmartSettingsForCurrentMode(){
    const requestedEngine = ['api','volcengine','modelscope','comfy','runninghub'].includes(settings.engine) ? settings.engine : 'api';
    const requestedApiKind = settings.apiKind === 'video' ? 'video' : 'image';
    const key = smartSettingsModeKey(settings);
    const saved = recentSmartSettingsForMode(key);
    if(!Object.keys(saved).length){
        settings.engine = requestedEngine;
        if(isApiLikeEngine(requestedEngine)) settings.apiKind = requestedApiKind;
        clearVolcengineSelectionOutsideVolcengine(settings);
        sanitizeSmartApiSelection(settings);
        return;
    }
    settings = {...settings, ...saved, engine:requestedEngine};
    if(isApiLikeEngine(requestedEngine)) settings.apiKind = requestedApiKind;
    clearVolcengineSelectionOutsideVolcengine(settings);
    sanitizeSmartApiSelection(settings);
}
function clearVolcengineSelectionOutsideVolcengine(target=settings){
    return SmartProviderConfig.clearVolcengineSelectionOutsideVolcengine(smartProviderConfigHost(), target);
}
function isSmartImageNode(node){
    return Boolean(node && (node.type === 'smart-image' || !node.type));
}
function isSmartGroupNode(node){
    return Boolean(node && node.type === 'smart-group');
}
function isSmartRunnableNode(node){
    return Boolean(isSmartImageNode(node) || isSmartGroupNode(node));
}
function smartOutputCoordinationHost(){
    return {
        get MEDIA_GROUP_DEFAULT_SCALE(){return MEDIA_GROUP_DEFAULT_SCALE;},
        get MEDIA_NODE_DEFAULT_SCALE(){return MEDIA_NODE_DEFAULT_SCALE;},
        get activeComposerSubject(){return activeComposerSubject;},
        get canvas(){return canvas;},
        get lastComposerNodeId(){return lastComposerNodeId;},
        set lastComposerNodeId(value){lastComposerNodeId=value;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get smartLoopContext(){return smartLoopContext;},
        addConnection:(...args)=>addConnection(...args),
        attachRunMeta:(...args)=>attachRunMeta(...args),
        clearSourceBusyStateIfDownstreamDone:(...args)=>clearSourceBusyStateIfDownstreamDone(...args),
        cloneSmartNode:(...args)=>cloneSmartNode(...args),
        connectInputNode:(...args)=>connectInputNode(...args),
        copyMediaSizeFields:(...args)=>copyMediaSizeFields(...args),
        downstreamNodesForId:(...args)=>downstreamNodesForId(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        liveSmartNode:(...args)=>liveSmartNode(...args),
        markSmartNodeComplete:(...args)=>markSmartNodeComplete(...args),
        mediaNodeDefaultScale:(...args)=>mediaNodeDefaultScale(...args),
        nodeRect:(...args)=>nodeRect(...args),
        nowMs:(...args)=>nowMs(...args),
        outgoingConnectionsFor:(...args)=>outgoingConnectionsFor(...args),
        pendingBoxSize:(...args)=>pendingBoxSize(...args),
        smartCascadePathForCtx:(...args)=>smartCascadePathForCtx(...args),
        stripImageGenerationMeta:(...args)=>stripImageGenerationMeta(...args),
        stripRunInputMeta:(...args)=>stripRunInputMeta(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function isHistoryGroupNode(node){
    return SmartOutputCoordination.isHistoryGroupNode(smartOutputCoordinationHost(), node);
}
function normalizeSmartImageMode(mode){
    return SmartNodeParams.normalizeSmartImageMode(smartNodeParamsHost(), mode);
}
function smartImageMode(node){
    return SmartNodeParams.smartImageMode(smartNodeParamsHost(), node);
}
function setSmartImageMode(node, mode){
    return SmartNodeParams.setSmartImageMode(smartNodeParamsHost(), node, mode);
}
function smartImageUsesWorkflowInput(node, ctx=smartLoopContext){
    return SmartNodeParams.smartImageUsesWorkflowInput(smartNodeParamsHost(), node, ctx);
}
function normalizeLegacySmartNode(node){
    return SmartNodeParams.normalizeLegacySmartNode(smartNodeParamsHost(), node);
}
function validOutpaintSize(node){
    return SmartNodeParams.validOutpaintSize(smartNodeParamsHost(), node);
}
function parseSizePair(value){
    return CanvasImageParams.parseSizePair(smartNodeParamsHost(), value);
}
function nearestFourKSizeFor(width, height){
    return CanvasImageParams.nearestFourKSizeFor(smartNodeParamsHost(), width, height);
}
function exceedsFourKStandard(width, height){
    return CanvasImageParams.exceedsFourKStandard(smartNodeParamsHost(), width, height);
}
function withOutpaintDisplaySettings(node, baseSettings){
    return SmartNodeParams.withOutpaintDisplaySettings(smartNodeParamsHost(), node, baseSettings);
}
function stripOutpaintDisplaySettings(settingsObj, node=null){
    const clean = cloneSmartSettings(settingsObj);
    const size = validOutpaintSize(node);
    const matchesOutpaintSize = size && clean.resolution === 'custom' && String(clean.customSize || '') === `${size.width}x${size.height}`;
    if(matchesOutpaintSize){
        clean.resolution = '1k';
        clean.ratio = clean.ratio || 'square';
        clean.customWidth = '';
        clean.customHeight = '';
        clean.customSize = '';
    }
    const matchesMsOutpaintSize = size && clean.msResolution === 'custom' && String(clean.msCustomSize || '') === `${size.width}x${size.height}`;
    if(matchesMsOutpaintSize){
        clean.msResolution = '1k';
        clean.msRatio = clean.msRatio || 'square';
        clean.msCustomWidth = '';
        clean.msCustomHeight = '';
        clean.msCustomSize = '';
    }
    if(size && Number(clean.width) === size.width && Number(clean.height) === size.height){
        clean.width = 1024;
        clean.height = 1024;
    }
    delete clean.outpaintResolutionLocked;
    return clean;
}
function smartSettingsForNode(node){
    const nodeSettings = stripOutpaintDisplaySettings(node?.runSettings || {}, node);
    const recentSettings = Object.keys(nodeSettings).length ? {} : recentSmartSettingsForMode();
    const base = {
        ...cloneSmartSettings(canvasDefaultSmartSettings || initialSmartSettings),
        ...recentSettings,
        ...nodeSettings
    };
    normalizeSmartVideoModeSettings(base, true);
    return withOutpaintDisplaySettings(node, base);
}
function activeSettingsSubject(){
    const active = activeComposerSubject?.id
        ? (nodes.find(n => n.id === activeComposerSubject.id) || activeComposerSubject)
        : selectedNode();
    return isSmartRunnableNode(active) ? active : null;
}
function activeComposerNode(){
    if(!lastComposerNodeId) return null;
    const id = String(lastComposerNodeId).split(':')[0] || '';
    const node = nodes.find(n => n.id === id);
    return isSmartRunnableNode(node) ? node : null;
}
function persistActiveSmartSettings(){
    if(!composer?.classList?.contains('open')) return;
    const subject = activeComposerNode();
    if(!subject) return;
    subject.runSettings = settingsForStorage(settings);
    rememberRecentSmartSettings(settings, subject);
}
function rememberCanvasListProject(projectId){
    const pid = projectId || 'default';
    try { localStorage.setItem(CANVAS_LIST_PROJECT_KEY, pid); } catch(e){}
    return pid;
}
function canvasListUrlForProject(projectId){
    const pid = rememberCanvasListProject(projectId);
    return `/static/canvas-list.html?project=${encodeURIComponent(pid)}`;
}
let returningToCanvasList = false;
function smartNavigationHost(){
    return {
        invalidateMediaInputContext:()=>{smartDeferredActions.invalidate();smartMediaInputController.invalidate();},
        get CanvasSaveTransport(){return CanvasSaveTransport;},
        get SMART_UNSAVED_ACCEPTED_TASKS_PREFIX(){return SMART_UNSAVED_ACCEPTED_TASKS_PREFIX;},
        get activeComposerSubject(){return activeComposerSubject;},
        set activeComposerSubject(value){activeComposerSubject=value;},
        get activeSmartComfyTaskPolls(){return activeSmartComfyTaskPolls;},
        get activeSmartTaskPolls(){return activeSmartTaskPolls;},
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get canvasBaseNodes(){return canvasBaseNodes;},
        set canvasBaseNodes(value){canvasBaseNodes=value;},
        get canvasDefaultSmartSettings(){return canvasDefaultSmartSettings;},
        set canvasDefaultSmartSettings(value){canvasDefaultSmartSettings=value;},
        get canvasId(){return canvasId;},
        get clearCurrentCanvasBtn(){return clearCurrentCanvasBtn;},
        get console(){return console;},
        get document(){return document;},
        get initialSmartSettings(){return initialSmartSettings;},
        get lastComposerNodeId(){return lastComposerNodeId;},
        set lastComposerNodeId(value){lastComposerNodeId=value;},
        get localStorage(){return localStorage;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get pendingUndoSnapshot(){return pendingUndoSnapshot;},
        set pendingUndoSnapshot(value){pendingUndoSnapshot=value;},
        get redoStack(){return redoStack;},
        get returningToCanvasList(){return returningToCanvasList;},
        set returningToCanvasList(value){returningToCanvasList=value;},
        get runTimerInterval(){return runTimerInterval;},
        set runTimerInterval(value){runTimerInterval=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get settings(){return settings;},
        set settings(value){settings=value;},
        get smartCascadeRuns(){return smartCascadeRuns;},
        get smartClientId(){return smartClientId;},
        resetDeferredActions:()=>smartDeferredActions.invalidate(),
        get smartSaveScheduler(){return smartSaveScheduler;},
        get smartSaveSession(){return smartSaveSession;},
        get sourceProjectId(){return sourceProjectId;},
        get transientSmartCloudLinks(){return transientSmartCloudLinks;},
        set transientSmartCloudLinks(value){transientSmartCloudLinks=value;},
        get undoStack(){return undoStack;},
        get viewport(){return viewport;},
        get window(){return window;},
        canvasListUrlForProject:(...args)=>canvasListUrlForProject(...args),
        clearInterval:(...args)=>clearInterval(...args),
        cloneSmartSettings:(...args)=>cloneSmartSettings(...args),
        fetch:(...args)=>fetch(...args),
        invalidateSmartVideoDeconstruction:(...args)=>invalidateSmartVideoDeconstruction(...args),
        rememberServerCanvasNodes:(...args)=>rememberServerCanvasNodes(...args),
        render:(...args)=>render(...args),
        renderDynamicParams:(...args)=>renderDynamicParams(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        savePromptDraftForCurrent:(...args)=>savePromptDraftForCurrent(...args),
        setCanvasSaveError:(...args)=>setCanvasSaveError(...args),
        smartCascadeAnyRunning:(...args)=>smartCascadeAnyRunning(...args),
        syncSmartCascadeLegacyState:(...args)=>syncSmartCascadeLegacyState(...args),
        toast:(...args)=>toast(...args)
    };
}
async function backToCanvasList(){
    return SmartNavigation.backToCanvasList(smartNavigationHost());
}
clearCurrentCanvasBtn?.addEventListener('click', () => {
    closeCreateMenu();
    clearCurrentSmartCanvas();
});

async function clearCurrentSmartCanvas(){
    return SmartNavigation.clearCurrentSmartCanvas(smartNavigationHost());
}
function promptPlainText(){
    return originalPromptTextFromParts(collectPromptParts());
}
function setPromptInputLocked(locked){
    promptInput.dataset.promptLocked = locked ? '1' : '0';
    promptInput.setAttribute('contenteditable', locked ? 'false' : 'true');
    promptInput.classList.toggle('prompt-input-locked', Boolean(locked));
    if(locked) closeMentionPicker();
}
function setPromptText(text){
    promptInput.textContent = text || '';
}
function clearPromptInput(options={}){
    if(options.preserveDraft){
        promptInput.dataset.preserveDraftOnce = '1';
        closeMentionPicker();
        return;
    }
    promptInput.textContent = '';
    closeMentionPicker();
    if(activeComposerSubject){
        activeComposerSubject.promptDraftHtml = '';
        activeComposerSubject.promptDraftText = '';
    }
}
function applyTheme(theme){
    const dark = theme === 'dark';
    document.documentElement.classList.toggle('theme-dark', dark);
    document.documentElement.classList.toggle('studio-theme-dark', dark);
    document.body?.classList.toggle('theme-dark', dark);
    document.body?.classList.toggle('studio-theme-dark', dark);
}
function toast(text){
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 1800);
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
function selectedNode(){
    return SmartSelection.selectedNode(smartLayoutHost());
}
function clearSelection(){
    return SmartSelection.clearSelection(smartLayoutHost());
}
function clearImageClickTimer(){
    if(imageClickTimer){
        clearTimeout(imageClickTimer);
        imageClickTimer = null;
    }
}
let smartSelectionUiNodeIds = new Set();
let smartSelectionUiImage = {nodeId:'', index:-1};
function syncSelectionUi(){
    return SmartSelection.syncSelectionUi(smartLayoutHost());
}
function syncSelectionGroup(){
    return SmartSelection.syncSelectionGroup(smartLayoutHost());
}
function isNodeSelected(id){
    return SmartSelection.isNodeSelected(smartLayoutHost(), id);
}
function selectedNodeIds(){
    return SmartSelection.selectedNodeIds(smartLayoutHost());
}
function isEditableTarget(target){
    const el = target || document.activeElement;
    return !!el?.closest?.('input, textarea, select, option, [contenteditable="true"], .prompt-node-control, .prompt-input');
}
function smartLayoutHost(){
    return {
        get EMPTY_UPLOAD_NODE_HEIGHT(){return EMPTY_UPLOAD_NODE_HEIGHT;},
        get EMPTY_UPLOAD_NODE_WIDTH(){return EMPTY_UPLOAD_NODE_WIDTH;},
        get MEDIA_GROUP_DEFAULT_SCALE(){return MEDIA_GROUP_DEFAULT_SCALE;},
        get MEDIA_GROUP_MAX_VISIBLE_ROWS(){return MEDIA_GROUP_MAX_VISIBLE_ROWS;},
        get MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE(){return MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE;},
        get MEDIA_GROUP_THUMB_BASE(){return MEDIA_GROUP_THUMB_BASE;},
        get MEDIA_NODE_DEFAULT_SCALE(){return MEDIA_NODE_DEFAULT_SCALE;},
        get SMART_GROUP_ARRANGE_GAP(){return SMART_GROUP_ARRANGE_GAP;},
        get SMART_GROUP_ARRANGE_HEADER(){return SMART_GROUP_ARRANGE_HEADER;},
        get SMART_GROUP_ARRANGE_PADDING(){return SMART_GROUP_ARRANGE_PADDING;},
        get SMART_GROUP_DEFAULT_HEIGHT(){return SMART_GROUP_DEFAULT_HEIGHT;},
        get SMART_GROUP_DEFAULT_WIDTH(){return SMART_GROUP_DEFAULT_WIDTH;},
        get SMART_GROUP_LEGACY_HEIGHT(){return SMART_GROUP_LEGACY_HEIGHT;},
        get SMART_GROUP_MAX_VISIBLE_ROWS(){return SMART_GROUP_MAX_VISIBLE_ROWS;},
        get SMART_GROUP_MIN_HEIGHT(){return SMART_GROUP_MIN_HEIGHT;},
        get SMART_GROUP_MIN_WIDTH(){return SMART_GROUP_MIN_WIDTH;},
        get canvas(){return canvas;},
        get nodes(){return nodes;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get selectionBox(){return selectionBox;},
        get selectionJustFinished(){return selectionJustFinished;},
        set selectionJustFinished(value){selectionJustFinished=value;},
        get selectionState(){return selectionState;},
        set selectionState(value){selectionState=value;},
        get shell(){return shell;},
        get smartArrangeBtn(){return smartArrangeBtn;},
        get smartSelectionUiImage(){return smartSelectionUiImage;},
        set smartSelectionUiImage(value){smartSelectionUiImage=value;},
        get smartSelectionUiNodeIds(){return smartSelectionUiNodeIds;},
        set smartSelectionUiNodeIds(value){smartSelectionUiNodeIds=value;},
        get viewport(){return viewport;},
        get world(){return world;},
        connectedSmartClusterIds:(...args)=>connectedSmartClusterIds(...args),
        isAudioMediaItem:(...args)=>isAudioMediaItem(...args),
        isSmartGroupCompactMember:(...args)=>isSmartGroupCompactMember(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        nodeRect:(...args)=>nodeRect(...args),
        promptNodeMinHeight:(...args)=>promptNodeMinHeight(...args),
        pushUndo:(...args)=>pushUndo(...args),
        render:(...args)=>render(...args),
        savePromptDraftForCurrent:(...args)=>savePromptDraftForCurrent(...args),
        scheduleConnectionLayerRefresh:(...args)=>scheduleConnectionLayerRefresh(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        selectedNodeIds:(...args)=>selectedNodeIds(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartGroupCompactMembers:(...args)=>smartGroupCompactMembers(...args),
        smartGroupImageRefs:(...args)=>smartGroupImageRefs(...args),
        smartGroupMembers:(...args)=>smartGroupMembers(...args),
        smartLoopPreviewImages:(...args)=>smartLoopPreviewImages(...args),
        smartLoopPromptFieldValues:(...args)=>smartLoopPromptFieldValues(...args),
        smartLoopUpstreamPromptPreviewHeight:(...args)=>smartLoopUpstreamPromptPreviewHeight(...args),
        smartNodeElementsByIds:(...args)=>smartNodeElementsByIds(...args),
        smartNodeInputThumbsHeight:(...args)=>smartNodeInputThumbsHeight(...args),
        syncRunButtonState:(...args)=>syncRunButtonState(...args),
        syncSmartGroupMemberElements:(...args)=>syncSmartGroupMemberElements(...args),
        syncSmartSelectedImageResolution:(...args)=>syncSmartSelectedImageResolution(...args),
        toast:(...args)=>toast(...args)
    };
}
function safeScale(value){
    return SmartLayout.safeScale(smartLayoutHost(), value);
}
function nodeScale(node){
    return SmartLayout.nodeScale(smartLayoutHost(), node);
}
const MEDIA_NODE_DEFAULT_SCALE = 2;
const MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE = 1.6;
const MEDIA_GROUP_DEFAULT_SCALE = 0.8;
const ZOOM_PREVIEW_NODE_DEFAULT_SCALE = 1;
const ZOOM_PREVIEW_NODE_MAX_SCALE = 1.15;
const MEDIA_GROUP_THUMB_BASE = 224;
const MEDIA_GROUP_MAX_VISIBLE_ROWS = 3;
// 智能分组卡片内的图片网格：超过这么多排就出现纵向滚动（区别于多图节点的 3 排）。
const SMART_GROUP_MAX_VISIBLE_ROWS = 4;
const EMPTY_UPLOAD_NODE_WIDTH = 316;
const EMPTY_UPLOAD_NODE_HEIGHT = 194;
const SMART_GROUP_DEFAULT_WIDTH = 340;
const SMART_GROUP_DEFAULT_HEIGHT = 286;
const SMART_GROUP_LEGACY_HEIGHT = 220;
// 分组可缩小到的最小尺寸（缩小分组时组内图片随之等比缩小，靠这个区间产生缩放系数）。
const SMART_GROUP_MIN_WIDTH = 150;
const SMART_GROUP_MIN_HEIGHT = 130;
// 组内成员（提示词/循环）的最大缩放。已移除“放大不超过原始”的限制：向外拉分组时成员随之放大。
const SMART_GROUP_MAX_MEMBER_ZOOM = 4;
function mediaNodeDefaultScale(node){
    return SmartLayout.mediaNodeDefaultScale(smartLayoutHost(), node);
}
function createImageNodeAt(point, images=[], options={}){
    return SmartNodeEdit.createImageNodeAt(smartNodeEditHost(), point, images, options);
}
function smartGroupLayoutSize(node){
    return SmartLayout.smartGroupLayoutSize(smartLayoutHost(), node);
}
function smartGroupMembers(node){
    if(!isSmartGroupNode(node)) return [];
    const ids = Array.isArray(node.items) ? node.items : [];
    const seen = new Set([node.id]);
    return ids.map(id => nodes.find(n => n.id === id)).filter(member => {
        if(!member || seen.has(member.id) || isSmartGroupNode(member)) return false;
        seen.add(member.id);
        return true;
    });
}
function smartGroupCompactMembers(node){
    return smartGroupMembers(node).filter(member => member?.type === 'smart-prompt' || member?.type === 'smart-loop');
}
function isSmartGroupCompactMember(node){
    return Boolean(node && (node.type === 'smart-prompt' || node.type === 'smart-loop') && smartGroupContainingNode(node.id));
}
// 分组当前缩放比例（1=原始）。分组就像“画布中的画布”：缩放分组时组内所有成员（含提示词）整体等比缩放+
// 重排。缩放过程用每次手势开始时的快照实时计算（见 resize 处理），不存持久基准，避免移动成员后再缩放位置回退。
// _memberZoom 仅用于：新入组的成员按它缩小，以匹配已经缩小的分组。
function smartGroupZoom(group){
    return SmartLayout.smartGroupZoom(smartLayoutHost(), group);
}
// 让新入组的成员贴合分组当前缩放（只改尺寸、保持落点不跳动）。
function scaleSmartGroupMemberToZoom(group, member, zoom){
    return SmartLayout.scaleSmartGroupMemberToZoom(smartLayoutHost(), group, member, zoom);
}
// 把指向 fromId 的连线/输入引用改接到 toId（吸收图片入组后保留“来源 → 分组”的连线），并去重去自环。
function rerouteSmartConnections(fromId, toId){
    return SmartGroupEdit.rerouteSmartConnections(smartNodeEditHost(), fromId, toId);
}
// 把一张图片节点的图片吸收进分组（收进卡片内的缩略图网格），然后删除该图片节点。
function absorbImageNodeIntoSmartGroup(group, child){
    return SmartGroupEdit.absorbImageNodeIntoSmartGroup(smartNodeEditHost(), group, child);
}
function setSmartGroupMemberIds(group, memberIds){
    return SmartGroupEdit.setSmartGroupMemberIds(smartNodeEditHost(), group, memberIds);
}
function addNodeToSmartGroup(group, child){
    return SmartGroupEdit.addNodeToSmartGroup(smartNodeEditHost(), group, child);
}
// 找到把某个节点作为成员的智能分组（用于双击组内图片时按整组左右切换）。
function smartGroupContainingNode(nodeId){
    if(!nodeId) return null;
    return nodes.find(n => isSmartGroupNode(n) && Array.isArray(n.items) && n.items.includes(nodeId)) || null;
}
// 节点所属的“分组作用域”ID：成员返回其分组，分组本体返回自身，否则空。
// 用于连线合并/隐藏：同一作用域内部的连线属于分组内部关系，无需画出。
function smartGroupScopeId(nodeId){
    const group = smartGroupContainingNode(nodeId);
    if(group) return group.id;
    const node = nodes.find(n => n.id === nodeId);
    return isSmartGroupNode(node) ? node.id : '';
}
// 汇总分组内所有图片成员的图片，按阅读顺序（先行后列：成员当前 y 再 x）排成一维序列。
// 返回 [{nodeId, index, source, item}]——source 是成员节点里真实的图片对象（写回自然尺寸用），
// item 是 imageForDisplay 后的展示对象。预览左右切换、批量下载、宫格拼接都以它为数据源。
function smartGroupImageRefs(group){
    if(!isSmartGroupNode(group)) return [];
    const refs = [];
    (group.images || []).forEach((img, index) => {
        const item = imageForDisplay(img);
        if(item?.url) refs.push({nodeId:group.id, index, source:img, item});
    });
    const members = smartGroupMembers(group)
        .filter(isSmartImageNode)
        .slice()
        .sort((a, b) => {
            const ra = nodeRect(a), rb = nodeRect(b);
            const dy = (Number(ra.y) || 0) - (Number(rb.y) || 0);
            if(Math.abs(dy) > 24) return dy;
            return (Number(ra.x) || 0) - (Number(rb.x) || 0);
        });
    members.forEach(node => {
        (node.images || []).forEach((img, index) => {
            const item = imageForDisplay(img);
            if(item?.url) refs.push({nodeId:node.id, index, source:img, item});
        });
    });
    return refs;
}
function smartGroupThumbLayout(node){
    return SmartLayout.smartGroupThumbLayout(smartLayoutHost(), node);
}
const SMART_GROUP_ARRANGE_PADDING = 18;
const SMART_GROUP_ARRANGE_GAP = 16;
const SMART_GROUP_ARRANGE_HEADER = 44;
// 把分组内的成员整理成整齐的网格（先行后列保持当前阅读顺序），列数尽量接近正方形，
// 每个成员在所属单元格内居中；最后把分组框尺寸收敛到正好包住所有成员。
function arrangeSmartGroupMembers(group, options={}){
    return SmartLayout.arrangeSmartGroupMembers(smartLayoutHost(), group, options);
}
function mediaLayoutSize(img){
    return SmartLayout.mediaLayoutSize(smartLayoutHost(), img);
}
function copyMediaSizeFields(source, target={}){
    if(!source || typeof source !== 'object') return target;
    ['natural_w','natural_h','width','height','w','h','layout_w','layout_h'].forEach(key => {
        const n = Number(source[key]);
        if(Number.isFinite(n) && n > 0) target[key] = n;
    });
    return target;
}
function singleImageLayout(image, node, scale){
    return SmartLayout.singleImageLayout(smartLayoutHost(), image, node, scale);
}
function groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad=32, gap=8, maxVisibleRows=MEDIA_GROUP_MAX_VISIBLE_ROWS){
    return SmartLayout.groupImageGridLayout(smartLayoutHost(), count, explicitW, explicitH, maxThumb, pad, gap, maxVisibleRows);
}
function smartNodeInputThumbRows(count){
    return count ? Math.ceil(Math.min(10, count) / 5) : 0;
}
function smartNodeInputThumbsHeight(images){
    const rows = smartNodeInputThumbRows((images || []).length);
    return rows ? rows * 44 + (rows - 1) * 6 + 8 : 0;
}
function promptNodeInputImages(node){
    return promptNodeInputMediaForLLM(node).filter(img => img?.url);
}
function promptNodeInputMediaForLLM(node){
    const refs = smartImageUsesWorkflowInput(node) ? workflowInputImagesFor(node) : inputImagesFor(node);
    return (refs || []).filter(ref => ref?.url);
}
function smartNodeInputThumbsHtml(images, opts={}){
    const refs = (images || []).filter(img => img?.url);
    if(!refs.length) return '';
    const limit = Math.min(10, refs.length);
    const items = refs.slice(0, limit).map((img, index) => {
        const label = opts.labelPrefix ? `${opts.labelPrefix}${index + 1}` : (window.StudioI18n?.lang?.() === 'en' ? `Image ${index + 1}` : `图${index + 1}`);
        const media = isAudioMediaItem(img)
            ? `<div class="media-thumb audio-thumb"><i data-lucide="file-audio"></i><span>${escapeHtml(img.name || 'Audio')}</span></div>`
            : isVideoMediaItem(img)
            ? smartVideoPreviewHtml(img, 256, 'alt=""')
            : smartPreviewImgHtml(img, 256, 'alt=""');
        return `<div class="smart-node-input-thumb" title="${escapeHtml(label)}">${media}<span class="smart-node-input-badge">${escapeHtml(label)}</span></div>`;
    }).join('');
    const more = refs.length > limit ? `<div class="smart-node-input-thumb smart-node-input-more">+${refs.length - limit}</div>` : '';
    return `<div class="smart-node-input-thumbs">${items}${more}</div>`;
}
const PROMPT_LLM_INSTRUCTION_DEFAULT_H = 58;
const PROMPT_LLM_INSTRUCTION_MIN_H = 40;
const PROMPT_LLM_INSTRUCTION_MAX_H = 400;
const PROMPT_SPLIT_PREVIEW_DEFAULT_H = 70;
const PROMPT_SPLIT_PREVIEW_MIN_H = 40;
const PROMPT_SPLIT_PREVIEW_MAX_H = 220;
const PROMPT_SPLIT_RESIZE_BAR_H = 9;
function promptLlmInstructionHeight(node){
    const h = Number(node?.llmInstructionHeight);
    if(!Number.isFinite(h)) return PROMPT_LLM_INSTRUCTION_DEFAULT_H;
    return Math.max(PROMPT_LLM_INSTRUCTION_MIN_H, Math.min(PROMPT_LLM_INSTRUCTION_MAX_H, Math.round(h)));
}
function promptNodeSeparator(node){
    const raw = String(node?.promptSeparator ?? ';');
    return raw === '' ? ';' : raw;
}
function promptNodePromptItems(node){
    const text = String(node?.text || '').trim();
    if(!text) return [];
    if(node?.promptSplitEnabled !== true) return [text];
    const sep = promptNodeSeparator(node);
    if(!sep) return [text];
    const items = text.split(sep).map(item => item.trim()).filter(Boolean);
    return items.length > 1 ? items : [text];
}
function promptNodeSplitExtraHeight(node){
    if(node?.promptSplitEnabled !== true) return 0;
    return 25 + promptNodeSplitPreviewHeight(node) + PROMPT_SPLIT_RESIZE_BAR_H;
}
function promptNodeSplitPreviewHeight(node){
    const h = Number(node?.promptSplitPreviewHeight);
    if(!Number.isFinite(h)) return PROMPT_SPLIT_PREVIEW_DEFAULT_H;
    return Math.max(PROMPT_SPLIT_PREVIEW_MIN_H, Math.min(PROMPT_SPLIT_PREVIEW_MAX_H, Math.round(h)));
}
function syncPromptNodeHeightForSplit(node, prevExtra=0){
    if(!node) return;

    const nextExtra = promptNodeSplitExtraHeight(node);
    const explicitH = Number(node.h);
    const currentH = Number.isFinite(explicitH) ? explicitH : 0;
    const fallbackH = promptNodeMinHeight(node);
    node.h = Math.max(fallbackH, currentH ? currentH - Math.max(0, prevExtra) + nextExtra : fallbackH);
    node.w = Math.max(Number(node.w) || 0, 316);
}
function promptNodeMinHeight(node){
    return node?.llmEnabled ? promptNodeExpandedHeight(node) : 240 + promptNodeSplitExtraHeight(node);
}
function promptTextItemsForNode(node, ctx=smartLoopContext){
    if(!node) return [];
    if(isSmartImageNode(node)&&node.audioOutputText)return [node.audioOutputText];
    if(node.type === 'smart-prompt') return node.llmEnabled && node.llmOutputStale ? [] : promptNodePromptItems(node);
    if(node.type === 'smart-loop'){
        const text = smartLoopPrompt(node, ctx);
        return text ? [text] : [];
    }
    if(node.type === 'smart-group') return smartGroupMembers(node).flatMap(member => promptTextItemsForNode(member, ctx));
    return [];
}
function promptNodeUpstreamPromptItems(node, ctx=smartLoopContext){
    const seen = new Set();
    return inputNodesFor(node).flatMap(input => promptTextItemsForNode(input, ctx)).map(text => String(text || '').trim()).filter(text => {
        if(!text || seen.has(text)) return false;
        seen.add(text);
        return true;
    });
}
function promptNodeUpstreamPromptText(node, ctx=smartLoopContext){
    return promptNodeUpstreamPromptItems(node, ctx).join('\n\n');
}
function promptNodeLLMInputText(node, ctx=smartLoopContext){
    return promptNodeUpstreamPromptText(node, ctx).trim();
}
function promptNodeExpandedHeight(node){
    // 指令文本框（发送给 LLM 的内容）可拖动加高，超出默认高度的部分要叠加进节点高度。
    const extra = Math.max(0, promptLlmInstructionHeight(node) - PROMPT_LLM_INSTRUCTION_DEFAULT_H);
    const upstreamExtra = node?.llmEnabled && promptNodeUpstreamPromptItems(node).length ? 74 : 0;
    return (node?.llmSystemEnabled ? 420 : 360) + smartNodeInputThumbsHeight(promptNodeInputImages(node)) + extra + upstreamExtra + promptNodeSplitExtraHeight(node);
}
function promptNodeLayoutSize(node){
    return SmartLayout.promptNodeLayoutSize(smartLayoutHost(), node);
}
// 智能分组的图片网格布局：跟多图节点一致，但可见排数上限为 4（超过出现滚动），且缩略图无放大上限
//（用户拉大分组时图片随之变大，不再封顶在原始尺寸）。
function smartGroupImageGridLayout(node){
    return SmartLayout.smartGroupImageGridLayout(smartLayoutHost(), node);
}
function imageLayout(images, scale=1, node=null){
    return SmartLayout.imageLayout(smartLayoutHost(), images, scale, node);
}
function smartLoopCount(node){
    return Math.max(1, Math.min(100, Number(node?.count || 1) || 1));
}
function smartLoopWidth(node){
    return SmartLayout.smartLoopWidth(smartLayoutHost(), node);
}
function smartLoopHeight(node){
    return SmartLayout.smartLoopHeight(smartLayoutHost(), node);
}
function fitSmartLoopNode(node){
    return SmartLayout.fitSmartLoopNode(smartLayoutHost(), node);
}


function nodeRect(node){
    return SmartLayout.nodeRect(smartLayoutHost(), node);
}
function connectedSmartClusterIds(seedId){
    const ids = new Set(nodes.map(n => n.id));
    if(!ids.has(seedId)) return [];
    const seen = new Set([seedId]);
    const queue = [seedId];
    while(queue.length){
        const id = queue.shift();
        (canvas?.connections || []).forEach(conn => {
            if(conn.from !== id && conn.to !== id) return;
            const next = conn.from === id ? conn.to : conn.from;
            if(!ids.has(next) || seen.has(next)) return;
            seen.add(next);
            queue.push(next);
        });
    }
    return [...seen];
}
function smartArrangeAtomicIds(ids){
    return SmartLayout.smartArrangeAtomicIds(smartLayoutHost(), ids);
}
function translateSmartNodeWithMembers(node, dx, dy, seen=new Set()){
    return SmartLayout.translateSmartNodeWithMembers(smartLayoutHost(), node, dx, dy, seen);
}
function moveSmartNodeAtom(node, x, y){
    return SmartLayout.moveSmartNodeAtom(smartLayoutHost(), node, x, y);
}
function arrangeSmartIdsByConnections(ids){
    return SmartLayout.arrangeSmartIdsByConnections(smartLayoutHost(), ids);
}
function arrangeSelectedSmartNodes(){
    return SmartLayout.arrangeSelectedSmartNodes(smartLayoutHost());
}
function smartViewportHost(){
    return {
        get SMART_LOG_PREVIEW_NODE_ID(){return SMART_LOG_PREVIEW_NODE_ID;},
        get ZOOM_PREVIEW_NODE_DEFAULT_SCALE(){return ZOOM_PREVIEW_NODE_DEFAULT_SCALE;},
        get ZOOM_PREVIEW_NODE_MAX_SCALE(){return ZOOM_PREVIEW_NODE_MAX_SCALE;},
        get document(){return document;},
        get minimapContent(){return minimapContent;},
        get minimapViewport(){return minimapViewport;},
        set minimapViewport(value){minimapViewport=value;},
        get nodes(){return nodes;},
        get shell(){return shell;},
        get smartArrangeBtn(){return smartArrangeBtn;},
        get smartMinimapState(){return smartMinimapState;},
        set smartMinimapState(value){smartMinimapState=value;},
        get viewport(){return viewport;},
        get window(){return window;},
        get world(){return world;},
        get zoomPreviewState(){return zoomPreviewState;},
        set zoomPreviewState(value){zoomPreviewState=value;},
        closeCreateMenu:(...args)=>closeCreateMenu(...args),
        nodeRect:(...args)=>nodeRect(...args),
        safeScale:(...args)=>safeScale(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        scheduleSmartImageResolutionSync:(...args)=>scheduleSmartImageResolutionSync(...args),
        selectedNodeIds:(...args)=>selectedNodeIds(...args),
        viewportCenter:(...args)=>viewportCenter(...args)
    };
}
function applyViewport(){
    return SmartViewport.applyViewport(smartViewportHost());
}
function screenToWorld(event){
    return SmartLayout.screenToWorld(smartLayoutHost(), event);
}
function viewportCenter(){
    return SmartLayout.viewportCenter(smartLayoutHost());
}
function renderMinimap(){
    return SmartViewport.renderMinimap(smartViewportHost());
}
function minimapEventToWorld(event){
    return SmartViewport.minimapEventToWorld(smartViewportHost(), event);
}
function centerViewportOnWorldPoint(point){
    return SmartViewport.centerViewportOnWorldPoint(smartViewportHost(), point);
}
function fitAllNodesViewport(){
    return SmartViewport.fitAllNodesViewport(smartViewportHost());
}
function enterZoomPreview(){
    return SmartViewport.enterZoomPreview(smartViewportHost());
}
function exitZoomPreview(point=null){
    return SmartViewport.exitZoomPreview(smartViewportHost(), point);
}
function exitZoomPreviewToNode(nodeId){
    return SmartViewport.exitZoomPreviewToNode(smartViewportHost(), nodeId);
}
function toggleZoomPreview(){
    return SmartViewport.toggleZoomPreview(smartViewportHost());
}
function smartProviderConfigHost(){
    return {
        get DEFAULT_VIDEO_MODELS(){return DEFAULT_VIDEO_MODELS;},
        get apiProviders(){return apiProviders;},
        set apiProviders(value){apiProviders=value;},
        get comfyInstanceCount(){return comfyInstanceCount;},
        set comfyInstanceCount(value){comfyInstanceCount=value;},
        get comfyWorkflows(){return comfyWorkflows;},
        set comfyWorkflows(value){comfyWorkflows=value;},
        get lastConfigRefreshAt(){return lastConfigRefreshAt;},
        set lastConfigRefreshAt(value){lastConfigRefreshAt=value;},
        get runningHubWorkflowCache(){return runningHubWorkflowCache;},
        set runningHubWorkflowCache(value){runningHubWorkflowCache=value;},
        get settings(){return settings;},
        applySettingsToNode:(...args)=>applySettingsToNode(...args),
        defaultSmartApiResolution:(...args)=>defaultSmartApiResolution(...args),
        ensureRunningHubWorkflow:(...args)=>ensureRunningHubWorkflow(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        isGptImageAutoSizeModel:(...args)=>isGptImageAutoSizeModel(...args),
        render:(...args)=>render(...args),
        renderDynamicParams:(...args)=>renderDynamicParams(...args),
        selectedNode:(...args)=>selectedNode(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        updateProviderModels:(...args)=>updateProviderModels(...args)
    };
}
function imageProviders(){
    return SmartProviderConfig.imageProviders(smartProviderConfigHost());
}
function volcengineProvider(){
    return SmartProviderConfig.volcengineProvider(smartProviderConfigHost());
}
function smartWorkflowConfigHost(){
    return {
        get apiProviders(){return apiProviders;},
        get comfyWorkflowCache(){return comfyWorkflowCache;},
        get runningHubWorkflowCache(){return runningHubWorkflowCache;},
        get settings(){return settings;},
        fetch:(...args)=>fetch(...args),
        rhActiveFields:(...args)=>rhActiveFields(...args),
        rhDefaultValue:(...args)=>rhDefaultValue(...args),
        rhEntryFields:(...args)=>rhEntryFields(...args),
        rhFieldRole:(...args)=>rhFieldRole(...args),
        rhWorkflowJsonFromSources:(...args)=>rhWorkflowJsonFromSources(...args)
    };
}
function runningHubProvider(){
    return SmartWorkflowConfig.runningHubProvider(smartWorkflowConfigHost());
}
function runningHubEntries(kind){
    return SmartWorkflowConfig.runningHubEntries(smartWorkflowConfigHost(), kind);
}
function runningHubEntryId(entry, kind){
    return SmartWorkflowConfig.runningHubEntryId(smartWorkflowConfigHost(), entry, kind);
}
function runningHubEntryLabel(entry, kind){
    return SmartWorkflowConfig.runningHubEntryLabel(smartWorkflowConfigHost(), entry, kind);
}









function runningHubEntryKey(kind, id){
    return SmartWorkflowConfig.runningHubEntryKey(smartWorkflowConfigHost(), kind, id);
}
function parseRunningHubEntryKey(value){
    return SmartWorkflowConfig.parseRunningHubEntryKey(smartWorkflowConfigHost(), value);
}
function runningHubAllEntries(){
    return SmartWorkflowConfig.runningHubAllEntries(smartWorkflowConfigHost());
}
function selectedRunningHubRef(sourceSettings=settings){
    return SmartWorkflowConfig.selectedRunningHubRef(smartWorkflowConfigHost(), sourceSettings);
}
function rhEntryFields(entry){
    return SmartWorkflowParams.rhEntryFields(smartWorkflowParamsHost(), entry);
}
function rhWorkflowJsonFromSources(...sources){
    return SmartWorkflowParams.rhWorkflowJsonFromSources(smartWorkflowParamsHost(), ...sources);
}
function rhCurrentKind(sourceSettings=settings){
    return SmartWorkflowParams.rhCurrentKind(smartWorkflowParamsHost(), sourceSettings);
}
function runningHubSelectedModel(sourceSettings=settings){
    return SmartWorkflowConfig.runningHubSelectedModel(smartWorkflowConfigHost(), sourceSettings);
}
function runningHubModelApiSettings(sourceSettings=settings){
    return SmartWorkflowConfig.runningHubModelApiSettings(smartWorkflowConfigHost(), sourceSettings);
}
function rhUsableFields(fields){
    return SmartWorkflowParams.rhUsableFields(smartWorkflowParamsHost(), fields);
}
function rhActiveFields(sourceSettings=settings){
    return SmartWorkflowParams.rhActiveFields(smartWorkflowParamsHost(), sourceSettings);
}
function runningHubRunNeedsPrompt(sourceSettings=settings){
    return SmartWorkflowConfig.runningHubRunNeedsPrompt(smartWorkflowConfigHost(), sourceSettings);
}
function smartRunNeedsPrompt(sourceSettings=settings){
    return SmartWorkflowConfig.smartRunNeedsPrompt(smartWorkflowConfigHost(), sourceSettings);
}
function sortRunningHubFields(fields){
    return [...(fields || [])].sort((a, b) => {
        const ak = rhFieldKind(a), bk = rhFieldKind(b);
        if(ak === 'image' && bk === 'image'){
            const ao = Number(a.imageOrder) || 9999;
            const bo = Number(b.imageOrder) || 9999;
            if(ao !== bo) return ao - bo;
        }
        if(ak === 'image' && bk !== 'image') return -1;
        if(ak !== 'image' && bk === 'image') return 1;
        return String(a.nodeId || '').localeCompare(String(b.nodeId || ''), undefined, {numeric:true}) || String(a.fieldName || '').localeCompare(String(b.fieldName || ''));
    });
}
function chatApiProviders(){
    return SmartProviderConfig.chatApiProviders(smartProviderConfigHost());
}
function resolveChatProviderId(providerId=''){
    return SmartProviderConfig.resolveChatProviderId(smartProviderConfigHost(), providerId);
}
function providerChatModels(providerId){
    return SmartProviderConfig.providerChatModels(smartProviderConfigHost(), providerId);
}
function resolveChatModel(model='', providerId=''){
    return SmartProviderConfig.resolveChatModel(smartProviderConfigHost(), model, providerId);
}
function chatProviderOptions(selectedId=''){
    return SmartProviderConfig.chatProviderOptions(smartProviderConfigHost(), selectedId);
}
function chatModelOptions(selectedModel='', providerId=''){
    return SmartProviderConfig.chatModelOptions(smartProviderConfigHost(), selectedModel, providerId);
}
function apiProviderById(providerId){
    return SmartProviderConfig.apiProviderById(smartProviderConfigHost(), providerId);
}
// 认证素材 asset:// 是平台绑定的：返回某 provider 所属的认证平台键（与后端一致）
function videoProviderPlatform(providerId){
    return SmartProviderConfig.videoProviderPlatform(smartProviderConfigHost(), providerId);
}
function providerImageModels(providerId){
    return SmartProviderConfig.providerImageModels(smartProviderConfigHost(), providerId);
}
const JIMENG_UPSCALE_RESOLUTIONS = ['2k', '4k', '8k'];
function isJimengProviderId(providerId){
    return SmartProviderConfig.isJimengProviderId(smartProviderConfigHost(), providerId);
}
function jimengImageProviderId(){
    return SmartProviderConfig.jimengImageProviderId(smartProviderConfigHost());
}
// 即梦图生图（挂了参考图）不支持 3.0/3.1，此时从模型下拉里隐藏它们。
const JIMENG_IMAGE2IMAGE_UNSUPPORTED = ['3.0', '3.1'];
function jimengImageEditMode(){
    if(!isJimengProviderId(settings.provider_id)) return false;
    const node = activeComposerNode() || selectedNode();
    const refs = node ? visibleReferenceImagesFor(node) : [];
    return refs.length > 0;
}
function filterJimengImageModels(models, providerId=settings.provider_id, editMode=jimengImageEditMode()){
    if(!isJimengProviderId(providerId) || !editMode) return models;
    return (models || []).filter(m => !JIMENG_IMAGE2IMAGE_UNSUPPORTED.includes(String(m)));
}
let _jimengLastEditMode = null;
let _jimengModelRefreshing = false;
// 参考图增删导致即梦文生图/图生图切换时，重新渲染参数面板以更新模型下拉。
function syncJimengModelPillForRefs(){
    if(_jimengModelRefreshing) return;
    if(!isJimengProviderId(settings.provider_id) || settings.engine !== 'api' || settings.apiKind === 'video'){
        _jimengLastEditMode = null;
        return;
    }
    const mode = jimengImageEditMode();
    if(mode === _jimengLastEditMode) return;
    _jimengLastEditMode = mode;
    _jimengModelRefreshing = true;
    try { scheduleDynamicParamsRefresh(80); } finally { _jimengModelRefreshing = false; }
}
// 即梦各视频指令支持的模型集合不同，按当前参考素材推断指令并过滤模型下拉。
const JIMENG_SEEDANCE_VIDEO_MODELS = ['seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.0', 'seedance2.0fast', 'seedance2.0mini'];
const JIMENG_VIDEO_MODELS_BY_COMMAND = {
    text2video: JIMENG_SEEDANCE_VIDEO_MODELS,
    multimodal2video: JIMENG_SEEDANCE_VIDEO_MODELS,
    image2video: ['seedance1.0fast', 'seedance1.5pro', ...JIMENG_SEEDANCE_VIDEO_MODELS],
    frames2video: ['seedance1.5pro', ...JIMENG_SEEDANCE_VIDEO_MODELS],
};
function jimengVideoCommand(){
    const node = activeComposerNode() || selectedNode();
    const refs = node ? visibleReferenceImagesFor(node) : [];
    const effectiveRefs = applyUploadedUrlsToSmartRefs(refs, settings);
    const imageRefs = imageRefsOnly(effectiveRefs);
    const hasVideoRef = videoRefsOnly(effectiveRefs).length > 0;
    if(settings.videoMultimodal || hasVideoRef) return 'multimodal2video';
    if(imageRefs.length >= 2) return settings.videoUseFrameRoles ? 'frames2video' : 'multiframe2video';
    if(imageRefs.length >= 1) return 'image2video';
    return 'text2video';
}
function filterJimengVideoModels(models){
    if(!isJimengProviderId(settings.videoProvider)) return models;
    const allowed = JIMENG_VIDEO_MODELS_BY_COMMAND[jimengVideoCommand()];
    if(!allowed) return models; // multiframe2video 等：官方规格未知，不过滤
    return (models || []).filter(m => allowed.includes(String(m)));
}
let _jimengLastVideoCommand = null;
function syncJimengVideoModelPillForRefs(){
    if(_jimengModelRefreshing) return;
    if(!isJimengProviderId(settings.videoProvider) || settings.engine !== 'api' || settings.apiKind !== 'video'){
        _jimengLastVideoCommand = null;
        return;
    }
    const command = jimengVideoCommand();
    if(command === _jimengLastVideoCommand) return;
    _jimengLastVideoCommand = command;
    _jimengModelRefreshing = true;
    try { scheduleDynamicParamsRefresh(80); } finally { _jimengModelRefreshing = false; }
}
function sanitizeSmartApiSelection(target=settings){
    return SmartProviderConfig.sanitizeSmartApiSelection(smartProviderConfigHost(), target);
}
function modelscopeProvider(){
    return SmartProviderConfig.modelscopeProvider(smartProviderConfigHost());
}
function modelscopeImageModels(){
    return SmartProviderConfig.modelscopeImageModels(smartProviderConfigHost());
}
const DEFAULT_VIDEO_MODELS = ['veo3-fast','veo3','sora','runway','kling','pika','minimax-video','wan-v2','seedance-1.0-pro','jimeng-vide-3.0','jimeng-video-3.0-pro'];
function videoApiProviders(){
    return SmartProviderConfig.videoApiProviders(smartProviderConfigHost());
}
function videoProviderById(providerId){
    return SmartProviderConfig.videoProviderById(smartProviderConfigHost(), providerId);
}
function providerVideoModels(providerId){
    return SmartProviderConfig.providerVideoModels(smartProviderConfigHost(), providerId);
}
function volcengineVideoModels(){
    return SmartProviderConfig.volcengineVideoModels(smartProviderConfigHost());
}
function renderVideoProviderControl(providers){
    return SmartParamControls.renderVideoProviderControl(smartParamPanelHost(), providers);
}
function renderVideoModelControl(models){
    return SmartParamControls.renderVideoModelControl(smartParamPanelHost(), models);
}
function renderVideoDurationControl(){
    return SmartParamControls.renderVideoDurationControl(smartParamPanelHost());
}
function renderVideoAspectControl(){
    return SmartParamControls.renderVideoAspectControl(smartParamPanelHost());
}
function renderVideoResolutionControl(){
    return SmartParamControls.renderVideoResolutionControl(smartParamPanelHost());
}
function renderVideoToggleControl(key, label){
    return SmartParamControls.renderVideoToggleControl(smartParamPanelHost(), key, label);
}
function renderTempShUploadControl(){
    return SmartParamControls.renderTempShUploadControl(smartParamPanelHost());
}
function renderManualVideoUrlControl(){
    return SmartParamControls.renderManualVideoUrlControl(smartParamPanelHost());
}
// 可信素材模式：打开后可选择素材来源——素材库认证链接 / 自行上传云端 / 自行输入网址。
function renderVideoTrustedAssetControl(){
    return SmartParamControls.renderVideoTrustedAssetControl(smartParamPanelHost());
}
function optionHtml(value, label, selected){
    return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label ?? value)}</option>`;
}
function parseSizeValue(value){
    return OnlineImageSizeRules.parseSizeValue(value);
}
function parseRatioValue(value){
    return SmartNodeParams.parseRatioValue(smartNodeParamsHost(), value);
}
function apiImageSize(ratioValue, resolutionValue, customRatioValue='', customSizeValue=''){
    return CanvasImageParams.apiImageSize(smartNodeParamsHost(), ratioValue, resolutionValue, customRatioValue, customSizeValue);
}
function normalizeApiSizeSettings(prefix=''){
    return SmartNodeParams.normalizeApiSizeSettings(smartNodeParamsHost(), prefix);
}
async function ensureComfyWorkflow(name){
    return SmartWorkflowConfig.ensureComfyWorkflow(smartWorkflowConfigHost(), name);
}
function currentComfyFields(){
    return SmartWorkflowConfig.currentComfyFields(smartWorkflowConfigHost());
}
function comfyParamValue(field){
    return SmartWorkflowParams.comfyParamValue(smartWorkflowParamsHost(), field);
}
function updateProviderModels(){ renderDynamicParams(); }
let dynamicParamsRefreshTimer = 0;
let dynamicParamsRefreshIdle = 0;
let dynamicParamsRefreshSeq = 0;
function scheduleDynamicParamsRefresh(delay=120){
    return SmartParamState.scheduleDynamicParamsRefresh(smartParamPanelHost(), delay);
}
function controlTypeKey(el){
    return SmartParamState.controlTypeKey(smartParamPanelHost(), el);
}
// 记住重渲染前哪个控件的弹层是打开的：pinned=点击药丸锁定，interacting=悬浮打开后点了里面的参数。
// 重渲染会重建 DOM、丢掉这两个状态，所以渲染后要按原样恢复，否则点一下就收起来了。
function openControlState(){
    return SmartParamState.openControlState(smartParamPanelHost());
}
function restoreOpenControl(state){
    return SmartParamState.restoreOpenControl(smartParamPanelHost(), state);
}
function dynamicParamsScrollSnapshot(){
    return SmartParamState.dynamicParamsScrollSnapshot(smartParamPanelHost());
}
function restoreDynamicParamsScroll(snapshot){
    return SmartParamState.restoreDynamicParamsScroll(smartParamPanelHost(), snapshot);
}
function smartParamPanelHost(){
    return {
        get JIMENG_UPSCALE_RESOLUTIONS(){return JIMENG_UPSCALE_RESOLUTIONS;},
        get MS_GEN_MODELS(){return MS_GEN_MODELS;},
        get apiProviders(){return apiProviders;},
        get comfyWorkflowCache(){return comfyWorkflowCache;},
        get comfyWorkflows(){return comfyWorkflows;},
        get document(){return document;},
        get dynamicParams(){return dynamicParams;},
        get dynamicParamsRefreshIdle(){return dynamicParamsRefreshIdle;},
        set dynamicParamsRefreshIdle(value){dynamicParamsRefreshIdle=value;},
        get dynamicParamsRefreshSeq(){return dynamicParamsRefreshSeq;},
        set dynamicParamsRefreshSeq(value){dynamicParamsRefreshSeq=value;},
        get dynamicParamsRefreshTimer(){return dynamicParamsRefreshTimer;},
        set dynamicParamsRefreshTimer(value){dynamicParamsRefreshTimer=value;},
        get engineSelect(){return engineSelect;},
        get escapeAttr(){return escapeAttr;},
        get lucide(){return lucide;},
        get settings(){return settings;},
        get window(){return window;},
        activeSettingsSubject:(...args)=>activeSettingsSubject(...args),
        apiImageSize:(...args)=>apiImageSize(...args),
        apiProviderById:(...args)=>apiProviderById(...args),
        applyRecentSmartSettingsForCurrentMode:(...args)=>applyRecentSmartSettingsForCurrentMode(...args),
        applySourceRatioToSettings:(...args)=>applySourceRatioToSettings(...args),
        bindDynamicParams:(...args)=>bindDynamicParams(...args),
        chatApiProviders:(...args)=>chatApiProviders(...args),
        clearTimeout:(...args)=>clearTimeout(...args),
        clearVolcengineSelectionOutsideVolcengine:(...args)=>clearVolcengineSelectionOutsideVolcengine(...args),
        comfyFieldKind:(...args)=>comfyFieldKind(...args),
        comfyParamValue:(...args)=>comfyParamValue(...args),
        comfyRandomEnabledField:(...args)=>comfyRandomEnabledField(...args),
        currentComfyFields:(...args)=>currentComfyFields(...args),
        defaultSmartApiResolution:(...args)=>defaultSmartApiResolution(...args),
        dynamicParamsScrollSnapshot:(...args)=>dynamicParamsScrollSnapshot(...args),
        ensureComfyWorkflow:(...args)=>ensureComfyWorkflow(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        filterJimengImageModels:(...args)=>filterJimengImageModels(...args),
        filterJimengVideoModels:(...args)=>filterJimengVideoModels(...args),
        imageProviders:(...args)=>imageProviders(...args),
        isGptImageAutoSizeModel:(...args)=>isGptImageAutoSizeModel(...args),
        isJimengProviderId:(...args)=>isJimengProviderId(...args),
        modelscopeImageModels:(...args)=>modelscopeImageModels(...args),
        msModelLabel:(...args)=>msModelLabel(...args),
        normalizeApiSizeSettings:(...args)=>normalizeApiSizeSettings(...args),
        normalizeSmartVideoModeSettings:(...args)=>normalizeSmartVideoModeSettings(...args),
        openControlState:(...args)=>openControlState(...args),
        optionHtml:(...args)=>optionHtml(...args),
        persistActiveSmartSettings:(...args)=>persistActiveSmartSettings(...args),
        providerChatModels:(...args)=>providerChatModels(...args),
        providerImageModels:(...args)=>providerImageModels(...args),
        providerVideoModels:(...args)=>providerVideoModels(...args),
        ratioIconClass:(...args)=>ratioIconClass(...args),
        ratioLabel:(...args)=>ratioLabel(...args),
        rememberRecentSmartSettings:(...args)=>rememberRecentSmartSettings(...args),
        renderComfySettingField:(...args)=>renderComfySettingField(...args),
        renderComfyWorkflowControl:(...args)=>renderComfyWorkflowControl(...args),
        renderCountVisualControl:(...args)=>renderCountVisualControl(...args),
        renderDynamicParams:(...args)=>renderDynamicParams(...args),
        renderJimengUpscaleControl:(...args)=>renderJimengUpscaleControl(...args),
        renderModelControl:(...args)=>renderModelControl(...args),
        renderMsCustomModelPill:(...args)=>renderMsCustomModelPill(...args),
        renderMsFunctionControl:(...args)=>renderMsFunctionControl(...args),
        renderProviderControl:(...args)=>renderProviderControl(...args),
        renderQualityControl:(...args)=>renderQualityControl(...args),
        renderRhConfigControl:(...args)=>renderRhConfigControl(...args),
        renderRhMachineControl:(...args)=>renderRhMachineControl(...args),
        renderRhPaymentControl:(...args)=>renderRhPaymentControl(...args),
        renderRhSettingField:(...args)=>renderRhSettingField(...args),
        renderSizePickerControl:(...args)=>renderSizePickerControl(...args),
        renderSmartApiAudioParams:(...args)=>renderSmartApiAudioParams(...args),
        renderUpscalePill:(...args)=>renderUpscalePill(...args),
        renderVideoAspectControl:(...args)=>renderVideoAspectControl(...args),
        renderVideoDurationControl:(...args)=>renderVideoDurationControl(...args),
        renderVideoModelControl:(...args)=>renderVideoModelControl(...args),
        renderVideoProviderControl:(...args)=>renderVideoProviderControl(...args),
        renderVideoResolutionControl:(...args)=>renderVideoResolutionControl(...args),
        renderVideoToggleControl:(...args)=>renderVideoToggleControl(...args),
        renderVideoTrustedAssetControl:(...args)=>renderVideoTrustedAssetControl(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        resolutionLabel:(...args)=>resolutionLabel(...args),
        restoreDynamicParamsScroll:(...args)=>restoreDynamicParamsScroll(...args),
        restoreOpenControl:(...args)=>restoreOpenControl(...args),
        rhActiveFields:(...args)=>rhActiveFields(...args),
        rhExtractFieldOptions:(...args)=>rhExtractFieldOptions(...args),
        rhFieldRole:(...args)=>rhFieldRole(...args),
        rhParamKey:(...args)=>rhParamKey(...args),
        rhParamValue:(...args)=>rhParamValue(...args),
        rhRandomEnabled:(...args)=>rhRandomEnabled(...args),
        runningHubEntries:(...args)=>runningHubEntries(...args),
        runningHubEntryId:(...args)=>runningHubEntryId(...args),
        runningHubEntryKey:(...args)=>runningHubEntryKey(...args),
        runningHubEntryLabel:(...args)=>runningHubEntryLabel(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedRunningHubRef:(...args)=>selectedRunningHubRef(...args),
        setCurrentSmartManualVideoUrl:(...args)=>setCurrentSmartManualVideoUrl(...args),
        setTimeout:(...args)=>setTimeout(...args),
        sizePickerDefaultResolution:(...args)=>sizePickerDefaultResolution(...args),
        sizePickerLabel:(...args)=>sizePickerLabel(...args),
        sizePickerScope:(...args)=>sizePickerScope(...args),
        smartApiAudioMode:(...args)=>smartApiAudioMode(...args),
        smartComfyRandomActive:(...args)=>smartComfyRandomActive(...args),
        smartHasAudioAnalysisInput:(...args)=>smartHasAudioAnalysisInput(...args),
        smartRhRandomActive:(...args)=>smartRhRandomActive(...args),
        sourceImageRatioLabel:(...args)=>sourceImageRatioLabel(...args),
        syncApiKindToggleVisibility:(...args)=>syncApiKindToggleVisibility(...args),
        syncRunButtonState:(...args)=>syncRunButtonState(...args),
        toast:(...args)=>toast(...args),
        toggleSmartComfyRandom:(...args)=>toggleSmartComfyRandom(...args),
        toggleSmartRhRandom:(...args)=>toggleSmartRhRandom(...args),
        tr:(...args)=>tr(...args),
        updatePromptPlaceholder:(...args)=>updatePromptPlaceholder(...args),
        uploadCurrentSmartVideosToCloud:(...args)=>uploadCurrentSmartVideosToCloud(...args),
        videoApiProviders:(...args)=>videoApiProviders(...args),
        videoAspectIconClass:(...args)=>videoAspectIconClass(...args),
        videoProviderById:(...args)=>videoProviderById(...args),
        volcengineProvider:(...args)=>volcengineProvider(...args),
        volcengineVideoModels:(...args)=>volcengineVideoModels(...args)
    };
}
function renderDynamicParams(){
    return SmartParamView.renderDynamicParams(smartParamPanelHost());
}
function renderApiParams(){
    return SmartParamView.renderApiParams(smartParamPanelHost());
}
function renderJimengUpscaleControl(){
    return SmartParamControls.renderJimengUpscaleControl(smartParamPanelHost());
}
function renderApiVideoParams(){
    return SmartParamView.renderApiVideoParams(smartParamPanelHost());
}
function renderVolcengineParams(){
    return SmartParamView.renderVolcengineParams(smartParamPanelHost());
}
function renderVolcengineVideoParams(){
    return SmartParamView.renderVolcengineVideoParams(smartParamPanelHost());
}
function renderRunningHubParams(){
    return SmartParamView.renderRunningHubParams(smartParamPanelHost());
}
function renderRhConfigControl(ref){
    return SmartParamControls.renderRhConfigControl(smartParamPanelHost(), ref);
}
function renderRhPaymentControl(){
    return SmartParamControls.renderRhPaymentControl(smartParamPanelHost());
}
function renderRhMachineControl(){
    return SmartParamControls.renderRhMachineControl(smartParamPanelHost());
}
function renderMsParams(){
    return SmartParamView.renderMsParams(smartParamPanelHost());
}
function renderComfyParams(){
    return SmartParamView.renderComfyParams(smartParamPanelHost());
}
function renderUpscalePill(paramKey, current){
    return SmartParamControls.renderUpscalePill(smartParamPanelHost(), paramKey, current);
}
function renderComfyWorkflowControl(){
    return SmartParamControls.renderComfyWorkflowControl(smartParamPanelHost());
}
function renderSizeControls(prefix='', includeSource=false){
    return SmartParamControls.renderSizeControls(smartParamPanelHost(), prefix, includeSource);
}
function ratioLabel(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const customKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    const sourceLabel = sourceImageRatioLabel(prefix) || tr('smart.imageRatio');
    const map = {square:'1:1', portrait:'2:3', landscape:'3:2', portrait43:'3:4', landscape43:'4:3', story:'9:16', wide:'16:9', ultrawide:'21:9', ultratall:'9:21', source:sourceLabel, custom:settings[customKey] || tr('smart.custom')};
    return map[settings[ratioKey] || 'square'] || '1:1';
}
function gcdInt(a, b){
    a = Math.abs(Math.round(Number(a) || 0));
    b = Math.abs(Math.round(Number(b) || 0));
    while(b){ const t = b; b = a % b; a = t; }
    return a || 1;
}
function imageSizeForRatio(img){
    const w = Math.round(Number(img?.natural_w || img?.width || img?.w || 0));
    const h = Math.round(Number(img?.natural_h || img?.height || img?.h || 0));
    return w > 0 && h > 0 ? {w, h} : null;
}
function sourceRatioImageForNode(node){
    const images = (node?.images || []).filter(img => img?.url && !isAudioMediaItem(img));
    if(!images.length) return null;
    if(selectedImage.nodeId === node?.id && selectedImage.index >= 0 && imagesForNode(node)[selectedImage.index]){
        const selected = imagesForNode(node)[selectedImage.index];
        if(imageSizeForRatio(selected)) return selected;
    }
    return images.find(img => imageSizeForRatio(img)) || images[0];
}
function reducedRatioForImage(img){
    const size = imageSizeForRatio(img);
    if(!size) return null;
    const d = gcdInt(size.w, size.h);
    return {w:Math.max(1, Math.round(size.w / d)), h:Math.max(1, Math.round(size.h / d))};
}
function sourceImageRatioLabel(prefix=''){
    const node = activeComposerNode() || selectedNode();
    const ratio = reducedRatioForImage(sourceRatioImageForNode(node));
    if(!ratio) return '';
    return `${ratio.w}:${ratio.h}`;
}
function applySourceRatioToSettings(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(settings[ratioKey] !== 'source') return;
    const ratio = reducedRatioForImage(sourceRatioImageForNode(activeComposerNode() || selectedNode()));
    if(!ratio) return;
    const customKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    settings[wKey] = ratio.w;
    settings[hKey] = ratio.h;
    settings[customKey] = `${ratio.w}:${ratio.h}`;
}
function resolutionLabel(prefix=''){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const sizeKey = prefix ? `${prefix}CustomSize` : 'customSize';
    const value = settings[resKey] || ((!prefix && settings.engine === 'api') ? defaultSmartApiResolution(settings.model) : '1k');
    if(value === 'auto') return '自动';
    return value === 'custom' ? (settings[sizeKey] || tr('smart.custom')) : value.toUpperCase();
}
function ratioIconClass(value){
    if(value === 'portrait') return 'r-portrait';
    if(value === 'portrait43') return 'r-portrait43';
    if(value === 'landscape') return 'r-landscape';
    if(value === 'landscape43') return 'r-landscape43';
    if(value === 'wide' || value === 'ultrawide') return 'r-wide';
    if(value === 'story' || value === 'ultratall') return 'r-story';
    if(value === 'source') return 'r-source';
    if(value === 'custom') return 'r-custom';
    return '';
}
function videoAspectIconClass(value){
    if(value === '16:9' || value === '21:9') return 'r-wide';
    if(value === '9:16' || value === '9:21') return 'r-story';
    if(value === '4:3') return 'r-landscape43';
    if(value === '3:4') return 'r-portrait43';
    if(value === 'keep_ratio' || value === 'adaptive') return 'r-source';
    return '';
}
function renderProviderControl(providers){
    return SmartParamControls.renderProviderControl(smartParamPanelHost(), providers);
}
function smartHasAudioAnalysisInput(node=activeSettingsSubject(),refs=null){
    return (refs || smartAudioSources(node)).some(ref=>ref?.kind==='audio');
}
function renderModelControl(models, options={}){
    return SmartParamControls.renderModelControl(smartParamPanelHost(), models, options);
}
function msModelLabel(key){
    if(key === 'custom') return tr('smart.custom');
    return MS_GEN_MODELS[key]?.label || key;
}
function renderMsFunctionControl(){
    return SmartParamControls.renderMsFunctionControl(smartParamPanelHost());
}
function renderMsCustomModelPill(){
    return SmartParamControls.renderMsCustomModelPill(smartParamPanelHost());
}
function renderRatioControl(prefix='', includeSource=false){
    return SmartParamControls.renderRatioControl(smartParamPanelHost(), prefix, includeSource);
}
function renderResolutionControl(prefix=''){
    return SmartParamControls.renderResolutionControl(smartParamPanelHost(), prefix);
}
function sizePickerScope(prefix=''){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const value = settings[resKey] || ((!prefix && settings.engine === 'api') ? defaultSmartApiResolution(settings.model) : '1k');
    if(value === 'auto') return 'auto';
    if(value === 'custom' || settings[ratioKey] === 'custom') return 'custom';
    return 'preset';
}
function sizePickerDefaultResolution(prefix=''){
    const value = (!prefix && settings.engine === 'api') ? defaultSmartApiResolution(settings.model) : '1k';
    return value === 'auto' ? '1k' : value;
}
function sizePickerLabel(prefix=''){
    const scope = sizePickerScope(prefix);
    if(scope === 'auto') return '自动';
    if(scope === 'custom'){
        const resKey = prefix ? `${prefix}Resolution` : 'resolution';
        const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
        const resText = resolutionLabel(prefix);
        const ratioText = ratioLabel(prefix);
        if(settings[resKey] === 'custom' && settings[ratioKey] === 'custom') return `自定义 · ${resText} · ${ratioText}`;
        if(settings[resKey] === 'custom') return `自定义 · ${resText}`;
        if(settings[ratioKey] === 'custom') return `自定义 · ${ratioText} · ${resText}`;
        return `自定义 · ${resText}`;
    }
    return `${ratioLabel(prefix)} · ${resolutionLabel(prefix)}`;
}
function renderSizePickerControl(prefix='', includeSource=false){
    return SmartParamControls.renderSizePickerControl(smartParamPanelHost(), prefix, includeSource);
}
function renderInlineCustomRatioFields(prefix=''){
    return SmartParamControls.renderInlineCustomRatioFields(smartParamPanelHost(), prefix);
}
function renderInlineCustomSizeFields(prefix=''){
    return SmartParamControls.renderInlineCustomSizeFields(smartParamPanelHost(), prefix);
}
function renderQualityControl(){
    return SmartParamControls.renderQualityControl(smartParamPanelHost());
}
function renderCountVisualControl(){
    return SmartParamControls.renderCountVisualControl(smartParamPanelHost());
}
function renderCountControl(){
    return SmartParamControls.renderCountControl(smartParamPanelHost());
}
function renderCustomRatioControls(prefix=''){
    return SmartParamControls.renderCustomRatioControls(smartParamPanelHost(), prefix);
}
function renderCustomSizeControls(prefix=''){
    return SmartParamControls.renderCustomSizeControls(smartParamPanelHost(), prefix);
}
function renderComfySettingField(field){
    return SmartParamControls.renderComfySettingField(smartParamPanelHost(), field);
}
const RH_KNOWN_FIELD_OPTIONS = {
    aspectRatio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    aspect_ratio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    ratio:['1:1','16:9','9:16','21:9','9:21','4:3','3:4','4:5','5:4','3:2','2:3'],
    resolution:['1k','2k','4k','8k'],
    size:['512','768','1024','1280','1536','2048'],
    quality:['low','medium','high','best'],
    scheduler:['normal','karras','exponential','sgm_uniform','simple','ddim_uniform'],
    sampler:['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc']
};
function smartWorkflowParamsHost(){
    return {
        get RH_KNOWN_FIELD_OPTIONS(){return RH_KNOWN_FIELD_OPTIONS;},
        get runningHubWorkflowCache(){return runningHubWorkflowCache;},
        get settings(){return settings;},
        get smartRhRandomValues(){return smartRhRandomValues;},
        currentRunningHubWorkflowConfig:(...args)=>currentRunningHubWorkflowConfig(...args),
        fetch:(...args)=>fetch(...args),
        selectedRunningHubRef:(...args)=>selectedRunningHubRef(...args),
        sortRunningHubFields:(...args)=>sortRunningHubFields(...args),
        tr:(...args)=>tr(...args)
    };
}
function rhParamKey(nodeId, fieldName){
    return SmartWorkflowParams.rhParamKey(smartWorkflowParamsHost(), nodeId, fieldName);
}
function rhFieldKind(field){
    return SmartWorkflowParams.rhFieldKind(smartWorkflowParamsHost(), field);
}
function rhFieldRole(field){
    return SmartWorkflowParams.rhFieldRole(smartWorkflowParamsHost(), field);
}
function rhExtractFieldOptions(field){
    return SmartWorkflowParams.rhExtractFieldOptions(smartWorkflowParamsHost(), field);
}
function rhDefaultValue(field){
    return SmartWorkflowParams.rhDefaultValue(smartWorkflowParamsHost(), field);
}
function rhIsWorkflowLinkValue(value){
    return SmartWorkflowParams.rhIsWorkflowLinkValue(smartWorkflowParamsHost(), value);
}
function rhRandomEnabled(field){
    return SmartWorkflowParams.rhRandomEnabled(smartWorkflowParamsHost(), field);
}
function smartRhRandomActive(key){
    return SmartWorkflowParams.smartRhRandomActive(smartWorkflowParamsHost(), key);
}
function smartRhRandomActiveFor(sourceSettings=settings, key){
    return SmartWorkflowParams.smartRhRandomActiveFor(smartWorkflowParamsHost(), sourceSettings, key);
}
function toggleSmartRhRandom(key){
    const field = rhActiveFields().find(f => rhParamKey(f.nodeId, f.fieldName) === key);
    if(!rhRandomEnabled(field)) return;
    settings.rhRandomActive = settings.rhRandomActive || {};
    settings.rhRandomActive[key] = !smartRhRandomActive(key);
    persistActiveSmartSettings();
    renderDynamicParams();
    scheduleSave();
}
function smartRhRandomValue(field){
    return SmartWorkflowParams.smartRhRandomValue(smartWorkflowParamsHost(), field);
}
function rhParamValue(field, media=null, sourceSettings=settings, fields=null, randomValues=smartRhRandomValues){
    return SmartWorkflowParams.rhParamValue(smartWorkflowParamsHost(), field, media, sourceSettings, fields, randomValues);
}
function rhUserParamValue(field){
    return SmartWorkflowParams.rhUserParamValue(smartWorkflowParamsHost(), field);
}
function rhPromptPlaceholder(field){
    return rhDefaultValue(field) || field?.label || field?.fieldName || tr('smart.promptPlaceholder');
}
function rhDefaultPromptSuggestion(){
    if(settings.engine !== 'runninghub') return '';
    const fields = rhActiveFields().filter(field => rhFieldRole(field) === 'prompt');
    for(const field of fields){
        const value = rhDefaultValue(field).trim();
        if(value) return value;
    }
    return '';
}
function updatePromptPlaceholder(){
    if(!promptInput) return;
    if(smartHasAudioAnalysisInput()){
        promptInput.dataset.placeholder='输入音频分析指令（可选）…';
        return;
    }
    if(smartApiAudioMode(activeSettingsSubject(),settings)){
        promptInput.dataset.placeholder=window.CanvasAudio.operation(settings,apiProviders)==='recognition'?'连接音频后点击运行识别；无需填写提示词':'输入台词或音乐描述…';
        return;
    }
    const suggestion = rhDefaultPromptSuggestion();
    promptInput.dataset.placeholder = suggestion || tr('smart.promptPlaceholder');
}
function rhFieldIndexes(fields){
    return SmartWorkflowParams.rhFieldIndexes(smartWorkflowParamsHost(), fields);
}
async function ensureRunningHubWorkflow(workflowId, options={}){
    return SmartWorkflowConfig.ensureRunningHubWorkflow(smartWorkflowConfigHost(), workflowId, options);
}
async function currentRunningHubWorkflowConfig(sourceSettings=settings){
    return SmartWorkflowConfig.currentRunningHubWorkflowConfig(smartWorkflowConfigHost(), sourceSettings);
}
function rhMediaForRun(prompt, refs){
    const cleanRefs = (refs || []).filter(ref => ref?.url);
    return {
        refs:cleanRefs,
        image:imageRefsOnly(cleanRefs),
        video:videoRefsOnly(cleanRefs),
        audio:audioRefsOnly(cleanRefs),
        prompt:String(prompt || '').trim()
    };
}
function tempShUploadedUrlFor(url, sourceSettings=settings){
    const source = String(url || '');
    const manualLinks = ((sourceSettings || settings).videoTempShLinks || []).filter(item => item?.manual === true);
    const links = [...(transientSmartCloudLinks || []), ...manualLinks];
    const match = links.find(item =>
        item?.url && (item?.source === source || item?.originalLocalUrl === source || item?.url === source)
    );
    return match?.url || url;
}
function mediaRefSourceUrl(ref){
    return localDisplayUrlForMediaItem(ref) || ref?.sourceUrl || ref?.originalLocalUrl || ref?.url || '';
}
function applyUploadedUrlsToSmartRefs(refs, sourceSettings=settings){
    return (refs || []).map(ref => {
        if(!ref?.url) return ref;
        const sourceUrl = mediaRefSourceUrl(ref);
        const url = tempShUploadedUrlFor(sourceUrl, sourceSettings);
        return url && url !== ref.url ? {...ref, url, originalLocalUrl:ref.originalLocalUrl || ref.url} : ref;
    });
}
function manualSmartVideoLink(sourceSettings=settings){
    return ((sourceSettings || settings).videoTempShLinks || []).find(item => item?.manual === true && item?.url) || null;
}
function manualSmartMediaLinks(sourceSettings=settings){
    return ((sourceSettings || settings).videoTempShLinks || []).filter(item => item?.manual === true && item?.url);
}
function renderedInputMediaRefs(){
    if(!inputThumbsRow) return [];
    return [...inputThumbsRow.querySelectorAll('.input-thumb')].map((el, index) => ({
        url:el.dataset.url || '',
        sourceUrl:el.dataset.sourceUrl || el.dataset.url || '',
        nodeId:el.dataset.nodeId || '',
        imageIndex:Number.isFinite(Number(el.dataset.imageIndex)) ? Number(el.dataset.imageIndex) : index,
        name:tr('smart.inputNum').replace('{n}', String(index + 1)),
        role:`image_${index + 1}`
    })).filter(ref => ref.url);
}
function currentSmartMediaRefs(node){
    if(!node) return [];
    const request = buildPromptRequest(node, null, true, smartLoopContext);
    return (request.refs || []).filter(ref => ref?.url && ['image','video'].includes(mediaKindForItem(ref)));
}
function currentUploadMediaRefs(node){
    const rendered = renderedInputMediaRefs();
    if(rendered.length) return rendered;
    return currentSmartMediaRefs(node);
}
function currentSmartMediaLinks(node=null){
    return currentUploadMediaRefs(node || activeSettingsSubject()).map(ref => {
        const sourceUrl = mediaRefSourceUrl(ref);
        const uploaded = tempShUploadedUrlFor(sourceUrl);
        return uploaded && uploaded !== sourceUrl ? uploaded : '';
    }).filter(Boolean);
}
function clearManualSmartVideoUrl(){
    settings.videoTempShLinks = (settings.videoTempShLinks || []).filter(item => item?.manual !== true);
}
function splitManualMediaUrls(text){
    return String(text || '')
        .split(/[\s,，]+/)
        .map(url => url.trim())
        .filter(Boolean);
}
async function uploadMediaRefToCloud(ref){
    const kind = mediaKindForItem(ref);
    const sourceUrl = mediaRefSourceUrl(ref);
    if(!sourceUrl) throw new Error('没有可上传的媒体');
    const existing = tempShUploadedUrlFor(sourceUrl);
    if(existing && existing !== sourceUrl) return existing;
    if(/^https?:\/\//i.test(sourceUrl)) return sourceUrl;
    const response = await fetch('/api/cloud-video/upload', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:sourceUrl, service:'auto'})
    });
    if(!response.ok) throw new Error(await smartResponseErrorMessage(response, '云端上传失败'));
    const data = await response.json();
    const uploadedUrl = data.url || '';
    if(!uploadedUrl) throw new Error('云端没有返回链接');
    transientSmartCloudLinks = [
        ...(transientSmartCloudLinks || []).filter(item => item?.source !== sourceUrl),
        {source:sourceUrl, url:uploadedUrl, expires:data.expires || '3 days', kind}
    ];
    return uploadedUrl;
}
function applyManualVideoUrlToSmartRef(ref, manualUrl){
    if(!manualUrl) return;
    const sourceUrl = mediaRefSourceUrl(ref) || manualUrl;
    settings.videoTempShLinks = [
        ...(settings.videoTempShLinks || []).filter(item => item?.source !== sourceUrl),
        {source:sourceUrl, url:manualUrl, manual:true}
    ];
}
async function setCurrentSmartManualVideoUrl(){
    const node = activeSettingsSubject();
    if(!node) return '';
    savePromptDraftForCurrent();
    const refs = currentUploadMediaRefs(node);
    const firstLocal = refs.find(ref => ref?.url && !isRemoteVideoReferenceUrl(ref.url));
    const firstAny = firstLocal || refs[0] || null;
    const linkedUrls = currentSmartMediaLinks(node);
    const currentLinks = linkedUrls.length ? linkedUrls : (firstAny ? [tempShUploadedUrlFor(mediaRefSourceUrl(firstAny))] : []);
    const value = await openAssetNameDialog({
        title:refs.length > 1 ? `输入 ${refs.length} 个媒体网址 / 火山素材 URI` : '输入媒体网址 / 火山素材 URI',
        value:currentLinks.filter(isRemoteVideoReferenceUrl).join('\n'),
        placeholder:refs.length > 1 ? '每行一个链接，按图1/图2顺序对应' : 'https://example.com/media 或 asset://asset-xxx',
        cancelValue:null,
        multiline:refs.length > 1
    });
    if(value === null) return '';
    const urls = splitManualMediaUrls(value);
    if(!urls.length){
        clearManualSmartVideoUrl();
        persistActiveSmartSettings();
        scheduleSave();
        render();
        toast('已清除手动网址');
        return '';
    }
    const invalid = urls.find(url => !isRemoteVideoReferenceUrl(url));
    if(invalid){
        toast('请输入 http/https 媒体网址或 asset:// 火山素材 URI');
        return '';
    }
    clearManualSmartVideoUrl();
    const targets = refs.length ? refs : [firstAny].filter(Boolean);
    urls.forEach((url, index) => {
        const target = targets[index] || targets[targets.length - 1] || {url};
        applyManualVideoUrlToSmartRef(target, url);
    });
    persistActiveSmartSettings();
    scheduleSave();
    render();
    toast(`已设置 ${urls.length} 个媒体网址`);
    return urls[0] || '';
}
async function uploadCurrentSmartVideosToCloud(){
    const node = activeSettingsSubject();
    if(!node) return [];
    savePromptDraftForCurrent();
    const refs = currentUploadMediaRefs(node);
    const localRefs = refs.filter(ref => {
        const sourceUrl = ref?.sourceUrl || ref?.originalLocalUrl || ref?.url || '';
        if(!sourceUrl) return false;
        const uploaded = tempShUploadedUrlFor(sourceUrl);
        return uploaded !== sourceUrl || !isRemoteVideoReferenceUrl(sourceUrl);
    });
    if(!localRefs.length){
        toast('当前输入图片或视频已是云端链接');
        return [];
    }
    const btn = dynamicParams?.querySelector('[data-trusted-source="cloud"]') || inputThumbsRow?.querySelector('[data-temp-sh-upload-video]');
    if(btn) btn.disabled = true;
    toast(`正在上传 ${localRefs.length} 个媒体文件到云端...`);
    try {
        const urls = [];
        for(const ref of localRefs){
            urls.push(await uploadMediaRefToCloud(ref));
        }
        toast(`云端上传完成：${urls.length} 个媒体文件`);
        return urls;
    } finally {
        if(btn) btn.disabled = false;
    }
}
function rhRequiredLabel(field){
    return SmartWorkflowParams.rhRequiredLabel(smartWorkflowParamsHost(), field);
}
function rhPruneWorkflowForMissingFields(workflowJson, missingFields){
    return SmartWorkflowParams.rhPruneWorkflowForMissingFields(smartWorkflowParamsHost(), workflowJson, missingFields);
}
function rhApplyNodeInfoListToWorkflow(workflowJson, nodeInfoList){
    return SmartWorkflowParams.rhApplyNodeInfoListToWorkflow(smartWorkflowParamsHost(), workflowJson, nodeInfoList);
}
function rhLooksLikeComplexDefault(field){
    return SmartWorkflowParams.rhLooksLikeComplexDefault(smartWorkflowParamsHost(), field);
}
async function rhBuildWorkflowRequestExtras(media, nodeInfoList, sourceSettings=settings){
    return SmartWorkflowParams.rhBuildWorkflowRequestExtras(smartWorkflowParamsHost(), media, nodeInfoList, sourceSettings);
}
async function rhUploadValueIfNeeded(value, sourceSettings=settings){
    return SmartWorkflowParams.rhUploadValueIfNeeded(smartWorkflowParamsHost(), value, sourceSettings);
}
async function rhBuildNodeInfoList(media, sourceSettings=settings, randomValues=smartRhRandomValues){
    return SmartWorkflowParams.rhBuildNodeInfoList(smartWorkflowParamsHost(), media, sourceSettings, randomValues);
}
function renderRhSettingField(field){
    return SmartParamControls.renderRhSettingField(smartParamPanelHost(), field);
}
function comfyRandomEnabledField(field){
    return SmartWorkflowParams.comfyRandomEnabledField(smartWorkflowParamsHost(), field);
}
function smartComfyRandomActive(fieldId){
    return SmartWorkflowParams.smartComfyRandomActive(smartWorkflowParamsHost(), fieldId);
}
function smartComfyRandomActiveFor(source, fieldId){
    return SmartWorkflowParams.smartComfyRandomActiveFor(smartWorkflowParamsHost(), source, fieldId);
}
function toggleSmartComfyRandom(fieldId){
    settings.comfyRandomActive = settings.comfyRandomActive || {};
    settings.comfyRandomActive[fieldId] = !smartComfyRandomActive(fieldId);
    persistActiveSmartSettings();
    renderDynamicParams();
    scheduleSave();
}
function smartComfyRandomValue(field){
    return SmartWorkflowParams.smartComfyRandomValue(smartWorkflowParamsHost(), field);
}
function setDynamicSetting(key, value){
    return SmartParamBindings.setDynamicSetting(smartParamPanelHost(), key, value);
}
function closeAllSmartPopovers(){
    return SmartParamBindings.closeAllSmartPopovers(smartParamPanelHost());
}
// 悬浮打开弹层后点了里面的参数：标记 interacting，让它熬过重渲染不收起；鼠标真正离开该控件时才关闭。
function markControlInteracting(el){
    return SmartParamBindings.markControlInteracting(smartParamPanelHost(), el);
}
function bindDynamicParams(){
    return SmartParamBindings.bindDynamicParams(smartParamPanelHost());
}
async function loadConfig(){
    return SmartProviderConfig.loadConfig(smartProviderConfigHost());
}
async function refreshSmartConfigFromSettings(){
    return SmartProviderConfig.refreshSmartConfigFromSettings(smartProviderConfigHost());
}
function smartPromptPresetHost(){
    return {
        get CSS(){return CSS;},
        get PROMPT_PRESETS_KEY(){return PROMPT_PRESETS_KEY;},
        get localStorage(){return localStorage;},
        get nodes(){return nodes;},
        get promptPresetApply(){return promptPresetApply;},
        get promptPresetDelete(){return promptPresetDelete;},
        get promptPresetDeleteArmed(){return promptPresetDeleteArmed;},
        set promptPresetDeleteArmed(value){promptPresetDeleteArmed=value;},
        get promptPresetName(){return promptPresetName;},
        get promptPresetNew(){return promptPresetNew;},
        get promptPresetPanel(){return promptPresetPanel;},
        get promptPresetSave(){return promptPresetSave;},
        get promptPresetSelect(){return promptPresetSelect;},
        get promptPresetStatus(){return promptPresetStatus;},
        get promptPresetText(){return promptPresetText;},
        get promptPresets(){return promptPresets;},
        set promptPresets(value){promptPresets=value;},
        get promptTemplateCategory(){return promptTemplateCategory;},
        set promptTemplateCategory(value){promptTemplateCategory=value;},
        get promptTemplateEditing(){return promptTemplateEditing;},
        set promptTemplateEditing(value){promptTemplateEditing=value;},
        get promptTemplateSelectedId(){return promptTemplateSelectedId;},
        set promptTemplateSelectedId(value){promptTemplateSelectedId=value;},
        get shell(){return shell;},
        get world(){return world;},
        escapeHtml:(...args)=>escapeHtml(...args),
        openPromptTemplatePanel:(...args)=>openPromptTemplatePanel(...args),
        promptPlainText:(...args)=>promptPlainText(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        render:(...args)=>render(...args),
        savePromptDraftForCurrent:(...args)=>savePromptDraftForCurrent(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function loadPromptPresets(){
    return SmartPromptPresets.loadPromptPresets(smartPromptPresetHost());
}
function savePromptPresets(){
    return SmartPromptPresets.savePromptPresets(smartPromptPresetHost());
}
function smartPromptTemplateHost(){
    return {
        get PROMPT_TEMPLATE_GROUPS_KEY(){return PROMPT_TEMPLATE_GROUPS_KEY;},
        get PROMPT_TEMPLATE_OVERRIDES_KEY(){return PROMPT_TEMPLATE_OVERRIDES_KEY;},
        get activePromptLibraryId(){return activePromptLibraryId;},
        set activePromptLibraryId(value){activePromptLibraryId=value;},
        get builtinPromptTemplates(){return builtinPromptTemplates;},
        set builtinPromptTemplates(value){builtinPromptTemplates=value;},
        get canvasAssistantTemplateCallback(){return canvasAssistantTemplateCallback;},
        set canvasAssistantTemplateCallback(value){canvasAssistantTemplateCallback=value;},
        get composerTemplateBtn(){return composerTemplateBtn;},
        get escapeAttr(){return escapeAttr;},
        get localStorage(){return localStorage;},
        get nodes(){return nodes;},
        get promptInput(){return promptInput;},
        get promptLibraries(){return promptLibraries;},
        set promptLibraries(value){promptLibraries=value;},
        get promptPresets(){return promptPresets;},
        set promptPresets(value){promptPresets=value;},
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
        get promptTemplateOverrides(){return promptTemplateOverrides;},
        set promptTemplateOverrides(value){promptTemplateOverrides=value;},
        get promptTemplatePanel(){return promptTemplatePanel;},
        get promptTemplateSearch(){return promptTemplateSearch;},
        get promptTemplateSelectedId(){return promptTemplateSelectedId;},
        set promptTemplateSelectedId(value){promptTemplateSelectedId=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get shell(){return shell;},
        get window(){return window;},
        currentPromptPreset:(...args)=>currentPromptPreset(...args),
        defaultPromptPresetName:(...args)=>defaultPromptPresetName(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        promptPlainText:(...args)=>promptPlainText(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        render:(...args)=>render(...args),
        renderInputThumbsRow:(...args)=>renderInputThumbsRow(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        savePromptDraftForCurrent:(...args)=>savePromptDraftForCurrent(...args),
        savePromptPresets:(...args)=>savePromptPresets(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedNode:(...args)=>selectedNode(...args),
        setPromptText:(...args)=>setPromptText(...args),
        get setStatus(){return typeof setStatus==='function' ? (...args)=>setStatus(...args) : undefined;},
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function defaultPromptTemplateGroups(){
    return SmartPromptTemplate.defaultPromptTemplateGroups(smartPromptTemplateHost());
}
function loadPromptTemplateGroups(){
    return SmartPromptTemplate.loadPromptTemplateGroups(smartPromptTemplateHost());
}
function savePromptTemplateGroups(){
    return SmartPromptTemplate.savePromptTemplateGroups(smartPromptTemplateHost());
}
function loadPromptTemplateOverrides(){
    return SmartPromptTemplate.loadPromptTemplateOverrides(smartPromptTemplateHost());
}
function savePromptTemplateOverrides(){
    return SmartPromptTemplate.savePromptTemplateOverrides(smartPromptTemplateHost());
}
async function loadPromptTemplates(){
    return SmartPromptTemplate.loadPromptTemplates(smartPromptTemplateHost());
}
function activePromptLibrary(){
    return SmartPromptTemplate.activePromptLibrary(smartPromptTemplateHost());
}
function renderPromptLibrarySelect(){
    return SmartPromptTemplate.renderPromptLibrarySelect(smartPromptTemplateHost());
}
function promptTemplateItems(){
    return SmartPromptTemplate.promptTemplateItems(smartPromptTemplateHost());
}
function promptTemplateText(template, mode='positive'){
    return SmartPromptTemplate.promptTemplateText(smartPromptTemplateHost(), template, mode);
}
function promptTemplateName(template){
    return SmartPromptTemplate.promptTemplateName(smartPromptTemplateHost(), template);
}
function promptTemplateScene(template){
    return SmartPromptTemplate.promptTemplateScene(smartPromptTemplateHost(), template);
}
function promptTemplateSearchText(template){
    return SmartPromptTemplate.promptTemplateSearchText(smartPromptTemplateHost(), template);
}
function activePromptTemplateGroups(){
    return SmartPromptTemplate.activePromptTemplateGroups(smartPromptTemplateHost());
}
function promptTemplateCategoryLabel(category){
    return SmartPromptTemplate.promptTemplateCategoryLabel(smartPromptTemplateHost(), category);
}
function promptTemplateSelectedItem(){
    return SmartPromptTemplate.promptTemplateSelectedItem(smartPromptTemplateHost());
}
function currentPromptPreset(id){
    return SmartPromptPresets.currentPromptPreset(smartPromptPresetHost(), id);
}
function defaultPromptPresetName(text){
    return SmartPromptPresets.defaultPromptPresetName(smartPromptPresetHost(), text);
}
function promptPresetPanelNode(){
    return SmartPromptPresets.promptPresetPanelNode(smartPromptPresetHost());
}
function setPromptPresetStatus(text='', tone=''){
    return SmartPromptPresets.setPromptPresetStatus(smartPromptPresetHost(), text, tone);
}
function resetPromptPresetDeleteState(){
    return SmartPromptPresets.resetPromptPresetDeleteState(smartPromptPresetHost());
}
function createPromptPresetFromNode(node, {openPanel=true, openTemplatePanel=false}={}){
    return SmartPromptPresets.createPromptPresetFromNode(smartPromptPresetHost(), node, arguments[1]);
}
function createPromptPresetFromComposer(){
    return SmartPromptPresets.createPromptPresetFromComposer(smartPromptPresetHost());
}
function savePromptNodeAsPreset(node){
    return SmartPromptPresets.savePromptNodeAsPreset(smartPromptPresetHost(), node);
}
function renderPromptPresetPanel(selectedId='', message=''){
    return SmartPromptPresets.renderPromptPresetPanel(smartPromptPresetHost(), selectedId, message);
}
function openPromptPresetPanel(nodeId='', presetId='', options={}){
    return SmartPromptPresets.openPromptPresetPanel(smartPromptPresetHost(), nodeId, presetId, options);
}
function closePromptPresetPanel(){
    return SmartPromptPresets.closePromptPresetPanel(smartPromptPresetHost());
}
function promptTemplateScrollSnapshot(){
    return SmartPromptTemplate.promptTemplateScrollSnapshot(smartPromptTemplateHost());
}
function restorePromptTemplateScroll(snapshot){
    return SmartPromptTemplate.restorePromptTemplateScroll(smartPromptTemplateHost(), snapshot);
}
function renderPromptTemplatePanel(options={}){
    return SmartPromptTemplate.renderPromptTemplatePanel(smartPromptTemplateHost(), options);
}
function activePromptTemplateNodeId(){
    return SmartPromptTemplate.activePromptTemplateNodeId(smartPromptTemplateHost());
}
function syncComposerTemplateButton(){
    return SmartPromptTemplate.syncComposerTemplateButton(smartPromptTemplateHost());
}
async function openPromptTemplatePanel(nodeId='', templateId='', options={}){
    return SmartPromptTemplate.openPromptTemplatePanel(smartPromptTemplateHost(), nodeId, templateId, options);
}
function closePromptTemplatePanel(){
    return SmartPromptTemplate.closePromptTemplatePanel(smartPromptTemplateHost());
}
function setPromptTemplateText(node,text){
    return SmartPromptTemplate.setPromptTemplateText(smartPromptTemplateHost(), node, text);
}
function applyPromptTemplateToNode(mode='positive'){
    return SmartPromptTemplate.applyPromptTemplateToNode(smartPromptTemplateHost(), mode);
}
async function saveCurrentPromptAsTemplate(){
    return SmartPromptTemplate.saveCurrentPromptAsTemplate(smartPromptTemplateHost());
}
async function createBlankPromptTemplate(){
    return SmartPromptTemplate.createBlankPromptTemplate(smartPromptTemplateHost());
}
async function savePromptTemplateEdit(){
    return SmartPromptTemplate.savePromptTemplateEdit(smartPromptTemplateHost());
}
async function deletePromptTemplate(){
    return SmartPromptTemplate.deletePromptTemplate(smartPromptTemplateHost());
}
async function createPromptTemplateGroup(){
    return SmartPromptTemplate.createPromptTemplateGroup(smartPromptTemplateHost());
}
async function renamePromptTemplateGroup(groupId){
    return SmartPromptTemplate.renamePromptTemplateGroup(smartPromptTemplateHost(), groupId);
}
async function deletePromptTemplateGroup(groupId){
    return SmartPromptTemplate.deletePromptTemplateGroup(smartPromptTemplateHost(), groupId);
}
function editPromptPresetForNode(node){
    return SmartPromptPresets.editPromptPresetForNode(smartPromptPresetHost(), node);
}
function smartAssetPanelHost(){
    return {
        get ASSET_SMART_CATEGORY_PREFIX(){return ASSET_SMART_CATEGORY_PREFIX;},
        get LOCAL_ASSET_LIBRARY_ID(){return LOCAL_ASSET_LIBRARY_ID;},
        get WebSocket(){return WebSocket;},
        get activeAssetCategoryId(){return activeAssetCategoryId;},
        set activeAssetCategoryId(value){activeAssetCategoryId=value;},
        get activeAssetLibraryId(){return activeAssetLibraryId;},
        set activeAssetLibraryId(value){activeAssetLibraryId=value;},
        get activeWorkflowAssetCategoryId(){return activeWorkflowAssetCategoryId;},
        set activeWorkflowAssetCategoryId(value){activeWorkflowAssetCategoryId=value;},
        get assetAddCategoryBtn(){return assetAddCategoryBtn;},
        get assetCategorySelect(){return assetCategorySelect;},
        get assetDialogBackdrop(){return assetDialogBackdrop;},
        get assetDialogCancel(){return assetDialogCancel;},
        get assetDialogInput(){return assetDialogInput;},
        get assetDialogOk(){return assetDialogOk;},
        get assetDialogTitle(){return assetDialogTitle;},
        get assetDropZone(){return assetDropZone;},
        get assetGrid(){return assetGrid;},
        get assetHoverPreview(){return assetHoverPreview;},
        get assetHoverTimer(){return assetHoverTimer;},
        set assetHoverTimer(value){assetHoverTimer=value;},
        get assetImageControls(){return assetImageControls;},
        get assetLibrary(){return assetLibrary;},
        set assetLibrary(value){assetLibrary=value;},
        get assetLibraryOpen(){return assetLibraryOpen;},
        set assetLibraryOpen(value){assetLibraryOpen=value;},
        get assetLibraryRefreshTimer(){return assetLibraryRefreshTimer;},
        set assetLibraryRefreshTimer(value){assetLibraryRefreshTimer=value;},
        get assetLibrarySelect(){return assetLibrarySelect;},
        get assetLibraryUpdatedAt(){return assetLibraryUpdatedAt;},
        set assetLibraryUpdatedAt(value){assetLibraryUpdatedAt=value;},
        get assetPanel(){return assetPanel;},
        get assetRenameCategoryBtn(){return assetRenameCategoryBtn;},
        get assetTab(){return assetTab;},
        get assetToggle(){return assetToggle;},
        get document(){return document;},
        get escapeAttr(){return escapeAttr;},
        get localAssetLibrary(){return localAssetLibrary;},
        set localAssetLibrary(value){localAssetLibrary=value;},
        get location(){return location;},
        get mentionAssetCategoryId(){return mentionAssetCategoryId;},
        set mentionAssetCategoryId(value){mentionAssetCategoryId=value;},
        get mentionPicker(){return mentionPicker;},
        get mentionSource(){return mentionSource;},
        get nodes(){return nodes;},
        get smartClientId(){return smartClientId;},
        get window(){return window;},
        get workflowEmpty(){return workflowEmpty;},
        activeAssetCategory:(...args)=>activeAssetCategory(...args),
        activeWorkflowAssetCategory:(...args)=>activeWorkflowAssetCategory(...args),
        assetCategories:(...args)=>assetCategories(...args),
        assetLibraries:(...args)=>assetLibraries(...args),
        assetLibraryIsLocal:(...args)=>assetLibraryIsLocal(...args),
        assetMediaKind:(...args)=>assetMediaKind(...args),
        assetSmartClassEntries:(...args)=>assetSmartClassEntries(...args),
        bindSmartPreviewImageFallbacks:(...args)=>bindSmartPreviewImageFallbacks(...args),
        clearTimeout:(...args)=>clearTimeout(...args),
        copyMediaSizeFields:(...args)=>copyMediaSizeFields(...args),
        currentAssetSourceLibraries:(...args)=>currentAssetSourceLibraries(...args),
        deleteLocalAssetFromPanel:(...args)=>deleteLocalAssetFromPanel(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        handleCanvasUpdatedMessage:(...args)=>handleCanvasUpdatedMessage(...args),
        hasCanvasImageDrag:(...args)=>hasCanvasImageDrag(...args),
        hasSmartImageDropData:(...args)=>hasSmartImageDropData(...args),
        importSmartLocalImages:(...args)=>importSmartLocalImages(...args),
        isSupportedUploadFile:(...args)=>isSupportedUploadFile(...args),
        itemsForAssetSmartClass:(...args)=>itemsForAssetSmartClass(...args),
        loadAssetLibrary:(...args)=>loadAssetLibrary(...args),
        parseAssetSmartClassId:(...args)=>parseAssetSmartClassId(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        render:(...args)=>render(...args),
        renderAssetLibrary:(...args)=>renderAssetLibrary(...args),
        renderMentionPicker:(...args)=>renderMentionPicker(...args),
        resolveSmartImageDropPayload:(...args)=>resolveSmartImageDropPayload(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setAssetLibraryFromResponse:(...args)=>setAssetLibraryFromResponse(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartImageNameFromUrl:(...args)=>smartImageNameFromUrl(...args),
        smartMediaPreviewUrl:(...args)=>smartMediaPreviewUrl(...args),
        smartPreviewImgHtml:(...args)=>smartPreviewImgHtml(...args),
        smartVideoPreviewHtml:(...args)=>smartVideoPreviewHtml(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        uploadFiles:(...args)=>uploadFiles(...args),
        workflowAssetCategories:(...args)=>workflowAssetCategories(...args)
    };
}
function assetCategories(type='image'){
    return SmartAssetModel.assetCategories(smartAssetPanelHost(), type);
}
function assetSmartClassKey(entry){
    return SmartAssetModel.assetSmartClassKey(smartAssetPanelHost(), entry);
}
function assetSmartClassOptionId(entry){
    return SmartAssetModel.assetSmartClassOptionId(smartAssetPanelHost(), entry);
}
function parseAssetSmartClassId(id=''){
    return SmartAssetModel.parseAssetSmartClassId(smartAssetPanelHost(), id);
}
function assetSmartClassEntries(){
    return SmartAssetModel.assetSmartClassEntries(smartAssetPanelHost());
}
function itemsForAssetSmartClass(optionId=''){
    return SmartAssetModel.itemsForAssetSmartClass(smartAssetPanelHost(), optionId);
}
function workflowAssetCategories(){
    return SmartAssetModel.workflowAssetCategories(smartAssetPanelHost());
}
function assetLibraries(){
    return SmartAssetModel.assetLibraries(smartAssetPanelHost());
}
function localAssetFolderCategories(){
    return SmartAssetModel.localAssetFolderCategories(smartAssetPanelHost());
}
function assetLibraryIsLocal(){
    return SmartAssetModel.assetLibraryIsLocal(smartAssetPanelHost());
}
function currentAssetSourceLibraries(){
    return SmartAssetModel.currentAssetSourceLibraries(smartAssetPanelHost());
}
function activeAssetLibrary(){
    return SmartAssetModel.activeAssetLibrary(smartAssetPanelHost());
}
function activeAssetCategory(){
    return SmartAssetModel.activeAssetCategory(smartAssetPanelHost());
}
function activeWorkflowAssetCategory(){
    return SmartAssetModel.activeWorkflowAssetCategory(smartAssetPanelHost());
}
function currentAssetTabIsWorkflow(){
    return SmartAssetModel.currentAssetTabIsWorkflow(smartAssetPanelHost());
}
function currentAssetTabCategories(){
    return SmartAssetModel.currentAssetTabCategories(smartAssetPanelHost());
}
function activeAssetTabCategory(){
    return SmartAssetModel.activeAssetTabCategory(smartAssetPanelHost());
}
function setActiveAssetTabCategory(categoryId=''){
    return SmartAssetModel.setActiveAssetTabCategory(smartAssetPanelHost(), categoryId);
}
async function loadAssetLibrary(){
    return SmartAssetModel.loadAssetLibrary(smartAssetPanelHost());
}
function refreshAssetLibrarySoon(delay=120){
    return SmartAssetModel.refreshAssetLibrarySoon(smartAssetPanelHost(), delay);
}
function handleAssetLibraryUpdatedMessage(data={}){
    return SmartAssetModel.handleAssetLibraryUpdatedMessage(smartAssetPanelHost(), data);
}
// 多人协作同步：一个稳定的客户端 id，既用于 WS 连接，也随 saveCanvas 上报，
// 服务器广播 canvas_updated 时带回 client_id，自己发的就忽略，避免自我刷新。
const smartClientId = `canvas_smart_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const smartSaveSession = CanvasSaveSession.create();
let canvasBaseNodes = new Map();
const smartRemoteSync = CanvasRemoteSync.createSmart({
    getState:()=>({id:canvasId,hasCanvas:Boolean(canvas),clientId:smartClientId,
        updatedAt:canvas?.updated_at,metaRevision:canvas?.meta_revision,
        isSaving:smartSaveSession.isSaving,dragging:Boolean(dragState),selecting:Boolean(selectionState)}),
    request:(...args)=>fetch(...args),apply:remote=>applyMergedServerCanvas(remote)
});
let connectionLayerRaf = 0;
function mergeSmartImageLists(localImgs, remoteImgs){
    const out = [];
    const seen = new Set();
    (localImgs || []).forEach(img => {
        const u = img && img.url;
        if(u && seen.has(u)) return;
        if(u) seen.add(u);
        out.push(img);
    });
    (remoteImgs || []).forEach(img => {
        const u = img && img.url;
        if(!u || seen.has(u)) return;
        seen.add(u);
        out.push(img);
    });
    return out;
}
function rememberServerCanvasNodes(serverCanvas){
    rememberServerCanvasNodes.snapshot = JSON.parse(JSON.stringify(serverCanvas || {}));
    rememberServerCanvasNodes.connections = JSON.parse(JSON.stringify(serverCanvas?.connections || []));
    canvasBaseNodes = new Map((Array.isArray(serverCanvas?.nodes) ? serverCanvas.nodes : [])
        .map(node => normalizeLegacySmartNode(JSON.parse(JSON.stringify(node))))
        .filter(node => node?.id)
        .map(node => [node.id, node]));
    rememberServerCanvasNodes.snapshot.nodes = Array.from(canvasBaseNodes.values());
}
function smartNodeInFlight(node){
    if(smartNodeHasCompletedResult(node)) return false;
    return Boolean(node && (node.running || node.pending || node.queued || node.jimengPending || smartPendingTasks(node).length));
}
function smartNodeHasDisplayResult(node){
    return Boolean((node?.images || []).some(img => img?.url && !img.loopInputPreview));
}
function smartNodeHasCompletedResult(node){
    if(!smartNodeHasDisplayResult(node)) return false;
    if(node?.runFinishedAt) return true;
    return !node?.jimengPending && !smartPendingTasks(node).length && !Number(node?.pending || 0) && !node?.queued;
}
function liveSmartNode(node){
    if(!node?.id) return node;
    return nodes.find(n => n.id === node.id) || node;
}
function clearSmartNodeBusyState(node){
    if(!node) return node;
    smartDeferredActions.cancelNode(node.id);
    node.running = false;
    node.pending = 0;
    node.queued = false;
    delete node.jimengPending;
    delete node.pendingTasks;
    return node;
}
function markSmartNodeComplete(node, meta=null){
    if(!node) return node;
    const keepHidden = node.runTimerHidden === true;
    clearSmartNodeBusyState(node);
    node.runFinishedAt = Number(node.runFinishedAt || 0) || nowMs();
    if(!node.runStartedAt) node.runStartedAt = meta?.createdAt || node.runFinishedAt;
    node.runElapsedMs = Math.max(0, Number(node.runFinishedAt || nowMs()) - Number(node.runStartedAt || node.runFinishedAt || nowMs()));
    node.runTimerHidden = meta?.hideTimer === true || keepHidden;
    return node;
}
function completedDownstreamOutputForNode(sourceNode){
    if(!sourceNode?.id) return null;
    const startedAt = Number(sourceNode.runStartedAt || 0);
    return downstreamImageTargetsFor(sourceNode).find(target => {
        if(!smartNodeHasCompletedResult(target)) return false;
        if(target.sourceNodeId && target.sourceNodeId !== sourceNode.id) return false;
        const finishedAt = Number(target.runFinishedAt || 0);
        return !startedAt || !finishedAt || finishedAt >= startedAt;
    }) || null;
}
function clearSourceBusyStateIfDownstreamDone(sourceNode, options={}){
    if(!sourceNode || !smartNodeInFlight(sourceNode)) return false;
    if(sourceNode.jimengPending || smartPendingTasks(sourceNode).length) return false;
    if(!completedDownstreamOutputForNode(sourceNode)) return false;
    clearSmartNodeBusyState(sourceNode);
    if(!sourceNode.runFinishedAt){
        sourceNode.runFinishedAt = nowMs();
        if(!sourceNode.runStartedAt) sourceNode.runStartedAt = sourceNode.runFinishedAt;
        sourceNode.runElapsedMs = Math.max(0, sourceNode.runFinishedAt - Number(sourceNode.runStartedAt || sourceNode.runFinishedAt));
        sourceNode.runTimerHidden = options.hideTimer === true || sourceNode.runTimerHidden === true;
    }
    return true;
}
function clearCompletedSourceBusyStates(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(clearSourceBusyStateIfDownstreamDone(node)) changed = true;
    });
    return changed;
}
function hideCompletedRunTimers(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(!node || node.type === 'smart-prompt') return;
        if(node.pending || node.running || node.jimengPending || !node.runFinishedAt || node.runTimerHidden) return;
        node.runTimerHidden = true;
        changed = true;
    });
    return changed;
}
function clearCompletedNodeBusyStates(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(!node || !smartNodeHasCompletedResult(node) || !smartNodeInFlight(node)) return;
        markSmartNodeComplete(node);
        changed = true;
    });
    if(clearCompletedSourceBusyStates()) changed = true;
    return changed;
}
function usedCanvasOutputUrls(){
    const used = new Set();
    (nodes || []).forEach(node => (node.images || []).forEach(img => {
        if(img?.url && !img.loopInputPreview) used.add(img.url);
    }));
    return used;
}
function successfulRecentComfyLogOutputs(sourceNodeId='', withinMs=30 * 60 * 1000){
    const cutoff = Date.now() - withinMs;
    const logs = (canvas?.logs || [])
        .filter(log => log && log.status === 'success' && Number(log.createdAt || 0) >= cutoff)
        .filter(log => log.request?.workflow_json || String(log.platform || '').toLowerCase().includes('comfy'))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const scoped = sourceNodeId ? logs.filter(log => log.nodeId === sourceNodeId) : logs;
    const usable = scoped.length ? scoped : logs.filter(log => !log.nodeId);
    return usable.flatMap(log => (log.outputs || []).map(url => ({url, createdAt:log.createdAt, nodeId:log.nodeId}))).filter(item => item.url);
}
function recoverStuckLoopOutputsFromLogs(){
    const used = usedCanvasOutputUrls();
    let changed = false;
    const slots = (nodes || [])
        .filter(node => node && isSmartImageNode(node) && !isHistoryGroupNode(node))
        .filter(node => (node.loopSourceId || node.loopRootId || Number.isFinite(Number(node.loopSlotIndex))) && !smartNodeHasDisplayResult(node))
        .filter(node => (node.pending || node.running || node.queued) && !smartPendingTasks(node).length)
        .sort((a, b) => (Number(a.loopSlotIndex || 0) - Number(b.loopSlotIndex || 0)) || (Number(a.y || 0) - Number(b.y || 0)));
    slots.forEach(slot => {
        const sourceId = slot.loopRootId || slot.sourceNodeId || '';
        const output = successfulRecentComfyLogOutputs(sourceId).find(item => !used.has(item.url));
        if(!output) return;
        const kind = mediaKindForUrls([output.url], 'image');
        const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : kind === 'text' ? 'txt' : 'png';
        slot.images = [stripImageGenerationMeta({url:output.url, name:`comfy-recovered-${Number(slot.loopSlotIndex || 0) + 1}.${ext}`, kind, generatedResult:true})];
        markSmartNodeComplete(slot);
        if(kind) slot.outputKind = kind;
        slot.title = slot.title || 'Image';
        slot.scale = mediaNodeDefaultScale(slot);
        delete slot.w;
        delete slot.h;
        used.add(output.url);
        changed = true;
        clearSourceBusyStateIfDownstreamDone(nodes.find(n => n.id === sourceId));
    });
    return changed;
}
function completeSmartNodeWithImages(node, images){
    const copy = {...node, images};
    if(smartNodeHasDisplayResult(copy)) markSmartNodeComplete(copy);
    return copy;
}
function syncRunButtonState(node=selectedNode()){
    if(!runBtn) return;
    // 只在“当前选中节点自己”忙时禁用运行：节点正在生成/排队，或它本身是正在跑的循环。
    // 不再因为“画布上有任意循环/级联在跑”就全局禁用——跑循环时仍可对其他节点点生成。
    const missingAudioModel=smartApiAudioMode(node,settings) && !window.CanvasAudio.isActive(node || {}) && !window.CanvasAudio.ready(settings,apiProviders);
    runBtn.disabled = !isSmartRunnableNode(node) || smartNodeInFlight(node) || smartCascadeIsLoopRunning(node?.id) || missingAudioModel;
}
function mergeSmartNode(local, remote, base=null, conflictCopies=null){
    const images = mergeSmartImageLists(local.images, remote.images);
    const localDone = smartNodeHasCompletedResult(local);
    const remoteDone = smartNodeHasCompletedResult(remote);
    const localBusy = smartNodeInFlight(local);
    const remoteBusy = smartNodeInFlight(remote);
    let merged;
    if(localDone && remoteBusy && !remoteDone) merged = completeSmartNodeWithImages(local, images);
    else if(remoteDone && localBusy && !localDone) merged = completeSmartNodeWithImages(remote, images);
    if(localDone && remoteDone){
        const localFinished = Number(local.runFinishedAt || 0);
        const remoteFinished = Number(remote.runFinishedAt || 0);
        merged = completeSmartNodeWithImages(remoteFinished >= localFinished ? remote : local, images);
    }
    // 本地正在生成/排队的节点完全以本地为准，只把对方可能多出来的图并进来，绝不被对方旧状态冲掉
    if(!merged && smartNodeInFlight(local)){
        merged = {...local, images};
    }
    // 否则以对方（最新保存方）的布局/标题/设置为基底，但图片取并集——双方生成结果都不丢
    if(!merged){
        merged = {...remote, images};
        if(smartNodeHasDisplayResult(merged) && (merged.pending || merged.queued || smartPendingTasks(merged).length)){
            merged = completeSmartNodeWithImages(merged, images);
        }
    }
    if(!base) return merged;
    // 以共同的服务端版本为基线：不同字段各保留改动，同一字段冲突则保留两个节点版本。
    const taskFields = new Set(['running', 'pending', 'queued', 'jimengPending', 'pendingTasks',
        'runStartedAt', 'runFinishedAt', 'runElapsedMs', 'runTimerHidden', 'timelinePlaying']);
    const fields = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    let hasConflict = false;
    fields.forEach(key => {
        if(key === 'id' || key === 'images' || taskFields.has(key)) return;
        const localChanged = JSON.stringify(local[key]) !== JSON.stringify(base[key]);
        const remoteChanged = JSON.stringify(remote[key]) !== JSON.stringify(base[key]);
        if(localChanged && remoteChanged && JSON.stringify(local[key]) !== JSON.stringify(remote[key])){
            hasConflict = true;
        }
        const source = remoteChanged ? remote : localChanged ? local : remote;
        if(Object.prototype.hasOwnProperty.call(source, key)) merged[key] = source[key];
        else delete merged[key];
    });
    if(hasConflict && conflictCopies){
        const copy = JSON.parse(JSON.stringify(local));
        copy.id = uid('smart');
        copy.title = `${copy.title || copy.type || '节点'}（本地冲突副本）`;
        const width = Math.max(316, Number(copy.w || 0));
        const originalX = Number(copy.x || 0);
        copy.x = originalX + (originalX > width + 24 ? -(width + 40) : width + 40);
        copy.running = false;
        copy.pending = 0;
        copy.queued = false;
        delete copy.jimengPending;
        delete copy.pendingTasks;
        Object.defineProperty(copy,'_conflictSourceId',{value:local.id});
        conflictCopies.push(copy);
    }
    return merged;
}
function mergeSmartNodeLists(localNodes, remoteNodes, baseNodes=canvasBaseNodes, conflictCopies=[]){
    const merged = window.CanvasSaveRecovery.mergeNodes(localNodes,remoteNodes,baseNodes,
        (local,remote,base)=>mergeSmartNode(local,remote,base,conflictCopies)).concat(conflictCopies);
    window.CanvasSaveRecovery.placeConflictCopies(conflictCopies,[...(localNodes || []),...(remoteNodes || [])]);
    return merged;
}
function mergeSmartConnections(localConns, remoteConns, nodeIds){
    const base = typeof rememberServerCanvasNodes === 'function' ? rememberServerCanvasNodes.connections || []
        : typeof canvasBaseConnections !== 'undefined' ? canvasBaseConnections : [];
    return window.CanvasSaveRecovery.mergeConnections(localConns,remoteConns,nodeIds,base);
}
function smartRemoteApplicationHost(){
    return {
        get canvas(){return canvas;},
        get canvasBaseNodes(){return canvasBaseNodes;},
        get document(){return document;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get setCanvasSaveError(){return setCanvasSaveError;},
        get window(){return window;},
        backupSmartDraft:(...args)=>backupSmartDraft(...args),
        clearCompletedNodeBusyStates:(...args)=>clearCompletedNodeBusyStates(...args),
        invalidateSmartVideoDeconstruction:(...args)=>invalidateSmartVideoDeconstruction(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        mergeSmartConnections:(...args)=>mergeSmartConnections(...args),
        mergeSmartNodeLists:(...args)=>mergeSmartNodeLists(...args),
        normalizeLegacySmartNode:(...args)=>normalizeLegacySmartNode(...args),
        recoverStuckLoopOutputsFromLogs:(...args)=>recoverStuckLoopOutputsFromLogs(...args),
        rememberServerCanvasNodes:(...args)=>rememberServerCanvasNodes(...args),
        render:(...args)=>render(...args),
        resumeJimengPendingNodes:(...args)=>resumeJimengPendingNodes(...args),
        resumeSmartAudioTasks:(...args)=>resumeSmartAudioTasks(...args),
        resumeSmartPendingTasks:(...args)=>resumeSmartPendingTasks(...args),
        get scheduleConnectionLayerRefresh(){return typeof scheduleConnectionLayerRefresh==='function' ? (...args)=>scheduleConnectionLayerRefresh(...args) : undefined;},
        scheduleSave:(...args)=>scheduleSave(...args),
        toast:(...args)=>toast(...args)
    };
}
function applyMergedServerCanvas(serverCanvas){
    return SmartRemoteApplication.applyMergedServerCanvas(smartRemoteApplicationHost(), serverCanvas);
}
async function mergeReloadCanvasNow(){ return smartRemoteSync.syncNow(); }
function handleCanvasUpdatedMessage(data={}){ smartRemoteSync.handleMessage(data); }
function startCanvasMetaPoll(){ smartRemoteSync.start(); }
window.addEventListener('pagehide',()=>{
    smartTextSelection.suspend();
    smartRemoteSync.stop();
});
window.addEventListener('pageshow',event=>{
    if(event.persisted) smartTextSelection.resume();
    if(event.persisted && canvas){
        smartRemoteSync.start();
        smartRemoteSync.syncNow();
    }
});
function connectAssetLibrarySyncSocket(){
    return SmartAssetModel.connectAssetLibrarySyncSocket(smartAssetPanelHost());
}
function setAssetLibraryFromResponse(data, options={}){
    return SmartAssetModel.setAssetLibraryFromResponse(smartAssetPanelHost(), data, options);
}
function toggleAssetLibrary(open=!assetLibraryOpen){
    return SmartAssetPanel.toggleAssetLibrary(smartAssetPanelHost(), open);
}
function assetCategoryForMention(){
    return SmartAssetPanel.assetCategoryForMention(smartAssetPanelHost());
}
function assetMediaKind(item){
    return SmartAssetPanel.assetMediaKind(smartAssetPanelHost(), item);
}
function assetNodeImageFromItem(item, fallbackName='asset'){
    return SmartAssetPanel.assetNodeImageFromItem(smartAssetPanelHost(), item, fallbackName);
}
function assetThumbHtml(item){
    return SmartAssetPanel.assetThumbHtml(smartAssetPanelHost(), item);
}
function renderAssetLibrary(){
    return SmartAssetPanel.renderAssetLibrary(smartAssetPanelHost());
}
function openAssetNameDialog({title='', value='', placeholder='', cancelValue='', multiline=false }={}){
    return SmartAssetPanel.openAssetNameDialog(smartAssetPanelHost(), arguments[0]);
}
let assetHoverTimer = 0;
function positionAssetHoverPreview(event){
    return SmartAssetPanel.positionAssetHoverPreview(smartAssetPanelHost(), event);
}
function showAssetHoverPreview(event, item){
    return SmartAssetPanel.showAssetHoverPreview(smartAssetPanelHost(), event, item);
}
function hideAssetHoverPreview(){
    return SmartAssetPanel.hideAssetHoverPreview(smartAssetPanelHost());
}
function beginAssetInlineRename(assetId){
    return SmartAssetPanel.beginAssetInlineRename(smartAssetPanelHost(), assetId);
}
function bindAssetItemEvents(){
    return SmartAssetPanel.bindAssetItemEvents(smartAssetPanelHost());
}
function bindWorkflowAssetItemEvents(){
    return SmartAssetPanel.bindWorkflowAssetItemEvents(smartAssetPanelHost());
}
async function addUrlToAssetLibrary(url, name=''){
    return SmartAssetImport.addUrlToAssetLibrary(smartAssetPanelHost(), url, name);
}
function localAssetFolderPath(){
    return SmartAssetImport.localAssetFolderPath(smartAssetPanelHost());
}
function setLocalAssetLibraryFromResponse(data){
    return SmartAssetImport.setLocalAssetLibraryFromResponse(smartAssetPanelHost(), data);
}
async function addFilesToLocalAssetLibrary(files=[]){
    return SmartAssetImport.addFilesToLocalAssetLibrary(smartAssetPanelHost(), files);
}
async function addLocalPathsToLocalAssetLibrary(paths=[]){
    return SmartAssetImport.addLocalPathsToLocalAssetLibrary(smartAssetPanelHost(), paths);
}
async function addUrlItemsToLocalAssetLibrary(items=[]){
    return SmartAssetImport.addUrlItemsToLocalAssetLibrary(smartAssetPanelHost(), items);
}
async function addUrlToLocalAssetLibrary(url, name=''){
    return SmartAssetImport.addUrlToLocalAssetLibrary(smartAssetPanelHost(), url, name);
}
async function deleteLocalAssetFromPanel(itemId){
    return SmartAssetImport.deleteLocalAssetFromPanel(smartAssetPanelHost(), itemId);
}
function canvasImageDragPayload(node, index=0){
    const img = node?.images?.[index];
    if(!img?.url) return null;
    return {url:img.url, name:img.name || node.title || 'image'};
}
// 迁移旧数据：早期把图片节点作为成员（items[]）放进分组的画布，统一把这些图片吸收进 group.images，
// 让它们显示为卡片内的缩略图网格（新模型）。一次性、幂等。
function migrateSmartGroupImageMembers(){
    let changed = false;
    nodes.filter(isSmartGroupNode).forEach(group => {
        const imageMemberIds = (Array.isArray(group.items) ? group.items : [])
            .map(id => nodes.find(n => n.id === id))
            .filter(m => m && isSmartImageNode(m) && (m.images || []).some(img => img?.url))
            .map(m => m.id);
        imageMemberIds.forEach(id => {
            const member = nodes.find(n => n.id === id);
            if(member && absorbImageNodeIntoSmartGroup(group, member)) changed = true;
        });
    });
    return changed;
}
function smartOpenCoordinatorHost(){
    return {
        beginMediaInputLoad:()=>{smartDeferredActions.invalidate();return smartMediaInputController.beginOpen();},
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get canvasDefaultSmartSettings(){return canvasDefaultSmartSettings;},
        set canvasDefaultSmartSettings(value){canvasDefaultSmartSettings=value;},
        get canvasId(){return canvasId;},
        get canvasUsesConnections(){return canvasUsesConnections;},
        set canvasUsesConnections(value){canvasUsesConnections=value;},
        get document(){return document;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get rememberServerCanvasNodes(){return rememberServerCanvasNodes;},
        get settings(){return settings;},
        set settings(value){settings=value;},
        get smartRemoteSync(){return smartRemoteSync;},
        get viewport(){return viewport;},
        set viewport(value){viewport=value;},
        get window(){return window;},
        applyViewport:(...args)=>applyViewport(...args),
        cleanupDetachedRunInputRefs:(...args)=>cleanupDetachedRunInputRefs(...args),
        clearCompletedNodeBusyStates:(...args)=>clearCompletedNodeBusyStates(...args),
        clearSmartNodeBusyState:(...args)=>clearSmartNodeBusyState(...args),
        cloneSmartSettings:(...args)=>cloneSmartSettings(...args),
        fetch:(...args)=>fetch(...args),
        hideCompletedRunTimers:(...args)=>hideCompletedRunTimers(...args),
        invalidateSmartVideoDeconstruction:(...args)=>invalidateSmartVideoDeconstruction(...args),
        loadRecentSmartSettings:(...args)=>loadRecentSmartSettings(...args),
        markSmartNodeComplete:(...args)=>markSmartNodeComplete(...args),
        migrateSmartGroupImageMembers:(...args)=>migrateSmartGroupImageMembers(...args),
        normalizeLegacySmartNode:(...args)=>normalizeLegacySmartNode(...args),
        normalizeSmartVideoModeSettings:(...args)=>normalizeSmartVideoModeSettings(...args),
        recoverStuckLoopOutputsFromLogs:(...args)=>recoverStuckLoopOutputsFromLogs(...args),
        rememberCanvasListProject:(...args)=>rememberCanvasListProject(...args),
        render:(...args)=>render(...args),
        restoreSmartDraft:(...args)=>restoreSmartDraft(...args),
        restoreSmartUnsavedAcceptedTasks:(...args)=>restoreSmartUnsavedAcceptedTasks(...args),
        resumeJimengPendingNodes:(...args)=>resumeJimengPendingNodes(...args),
        resumeSmartAudioTasks:(...args)=>resumeSmartAudioTasks(...args),
        resumeSmartPendingTasks:(...args)=>resumeSmartPendingTasks(...args),
        safeScale:(...args)=>safeScale(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setCanvasSaveError:(...args)=>setCanvasSaveError(...args),
        smartDraftConflictCopy:(...args)=>smartDraftConflictCopy(...args),
        smartNodeHasDisplayResult:(...args)=>smartNodeHasDisplayResult(...args),
        smartPendingTasks:(...args)=>smartPendingTasks(...args),
        startCanvasMetaPoll:(...args)=>startCanvasMetaPoll(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        updateProviderModels:(...args)=>updateProviderModels(...args)
    };
}
async function loadCanvas(){
    return SmartOpenCoordinator.loadCanvas(smartOpenCoordinatorHost());
}
function smartSaveCoordinatorHost(){
    return {
        get CanvasSaveTransport(){return CanvasSaveTransport;},
        get SMART_LOG_PREVIEW_NODE_ID(){return SMART_LOG_PREVIEW_NODE_ID;},
        get canvas(){return canvas;},
        set canvas(value){canvas=value;},
        get canvasDefaultSmartSettings(){return canvasDefaultSmartSettings;},
        set canvasDefaultSmartSettings(value){canvasDefaultSmartSettings=value;},
        get canvasId(){return canvasId;},
        get console(){return console;},
        get document(){return document;},
        get initialSmartSettings(){return initialSmartSettings;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get redoBaseContent(){return redoBaseContent;},
        set redoBaseContent(value){redoBaseContent=value;},
        get redoStack(){return redoStack;},
        get rememberServerCanvasNodes(){return rememberServerCanvasNodes;},
        get setCanvasSaveError(){return setCanvasSaveError;},
        get smartClientId(){return smartClientId;},
        get smartSaveScheduler(){return smartSaveScheduler;},
        get smartSaveSession(){return smartSaveSession;},
        get undoSuppressed(){return undoSuppressed;},
        get viewport(){return viewport;},
        get window(){return window;},
        applyMergedServerCanvas:(...args)=>applyMergedServerCanvas(...args),
        canvasForStorage:(...args)=>canvasForStorage(...args),
        get clearSmartUnsavedAcceptedTasks(){return typeof clearSmartUnsavedAcceptedTasks==='function' ? (...args)=>clearSmartUnsavedAcceptedTasks(...args) : undefined;},
        cloneSmartNode:(...args)=>cloneSmartNode(...args),
        cloneSmartSettings:(...args)=>cloneSmartSettings(...args),
        fetch:(...args)=>fetch(...args),
        historyContentSignature:(...args)=>historyContentSignature(...args),
        mediaItemForStorage:(...args)=>mediaItemForStorage(...args),
        normalizeLegacySmartNode:(...args)=>normalizeLegacySmartNode(...args),
        savePromptDraftForCurrent:(...args)=>savePromptDraftForCurrent(...args),
        serializableSmartNode:(...args)=>serializableSmartNode(...args),
        settingsForStorage:(...args)=>settingsForStorage(...args),
        stripImageGenerationMeta:(...args)=>stripImageGenerationMeta(...args),
        tr:(...args)=>tr(...args)
    };
}
function scheduleSave(){
    return SmartSaveCoordinator.scheduleSave(smartSaveCoordinatorHost());
}
function backupSmartDraft(){
    return SmartSaveCoordinator.backupSmartDraft(smartSaveCoordinatorHost());
}
function smartDraftConflictCopy(node){
    return SmartSaveCoordinator.smartDraftConflictCopy(smartSaveCoordinatorHost(), node);
}
function restoreSmartDraft(){
    return SmartSaveCoordinator.restoreSmartDraft(smartSaveCoordinatorHost());
}
function setCanvasSaveError(visible){
    const warning = document.getElementById('canvasSaveError');
    if(warning) warning.hidden = !(visible || setCanvasSaveError.conflict);
    if(visible && !setCanvasSaveError.conflict){
        const label = document.querySelector?.('#canvasSaveError span');
        if(label) label.textContent = '保存失败，当前修改尚未保存。请检查连接后重试。';
    }
}
function retryCanvasSave(){
    setCanvasSaveError.conflict = false;
    smartSaveScheduler.cancel();
    saveCanvas();
}
async function saveCanvas(){
    return SmartSaveCoordinator.saveCanvas(smartSaveCoordinatorHost());
}
function imageMetaFromNode(node){
    return {};
}
function applyNodeMetaToImage(image, node){
    return stripImageGenerationMeta(image);
}
function inheritNodeMetaFromImage(node){
    if(!node) return;
    node.images = (node.images || []).map(img => stripImageGenerationMeta(img));
}
function smartNodeEditHost(){
    return {
        cancelNodeCooldown:id=>smartDeferredActions.cancelNode(id),
        get MEDIA_GROUP_DEFAULT_SCALE(){return MEDIA_GROUP_DEFAULT_SCALE;},
        get MEDIA_NODE_DEFAULT_SCALE(){return MEDIA_NODE_DEFAULT_SCALE;},
        get SMART_GROUP_DEFAULT_HEIGHT(){return SMART_GROUP_DEFAULT_HEIGHT;},
        get SMART_GROUP_DEFAULT_WIDTH(){return SMART_GROUP_DEFAULT_WIDTH;},
        get canvas(){return canvas;},
        get createMenuGroupId(){return createMenuGroupId;},
        set createMenuGroupId(value){createMenuGroupId=value;},
        get createMenuPoint(){return createMenuPoint;},
        get document(){return document;},
        get lastMouseWorld(){return lastMouseWorld;},
        get lastNodePasteAt(){return lastNodePasteAt;},
        set lastNodePasteAt(value){lastNodePasteAt=value;},
        get nodeClipboard(){return nodeClipboard;},
        set nodeClipboard(value){nodeClipboard=value;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get window(){return window;},
        addCreatedNodeToMenuGroup:(...args)=>addCreatedNodeToMenuGroup(...args),
        arrangeSmartGroupMembers:(...args)=>arrangeSmartGroupMembers(...args),
        clearDetachedRunInputRefs:(...args)=>clearDetachedRunInputRefs(...args),
        clearSmartNodeTransientRunState:(...args)=>clearSmartNodeTransientRunState(...args),
        closeCreateMenu:(...args)=>closeCreateMenu(...args),
        demoteHistoryGroupNode:(...args)=>demoteHistoryGroupNode(...args),
        fitSmartLoopNode:(...args)=>fitSmartLoopNode(...args),
        historyGroupForNode:(...args)=>historyGroupForNode(...args),
        imageLayout:(...args)=>imageLayout(...args),
        imagesForNode:(...args)=>imagesForNode(...args),
        inheritNodeMetaFromImage:(...args)=>inheritNodeMetaFromImage(...args),
        isEditableTarget:(...args)=>isEditableTarget(...args),
        isHistoryGroupNode:(...args)=>isHistoryGroupNode(...args),
        isNodeSelected:(...args)=>isNodeSelected(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        mediaNodeDefaultScale:(...args)=>mediaNodeDefaultScale(...args),
        nodeRect:(...args)=>nodeRect(...args),
        nodeScale:(...args)=>nodeScale(...args),
        promptTextItemsForNode:(...args)=>promptTextItemsForNode(...args),
        pushUndo:(...args)=>pushUndo(...args),
        remapSmartDepthCopies:(...args)=>remapSmartDepthCopies(...args),
        remapSmartViewAdjustRefs:(...args)=>remapSmartViewAdjustRefs(...args),
        render:(...args)=>render(...args),
        resolveChatModel:(...args)=>resolveChatModel(...args),
        resolveChatProviderId:(...args)=>resolveChatProviderId(...args),
        scaleSmartGroupMemberToZoom:(...args)=>scaleSmartGroupMemberToZoom(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedNodeIds:(...args)=>selectedNodeIds(...args),
        smartGroupMembers:(...args)=>smartGroupMembers(...args),
        smartGroupZoom:(...args)=>smartGroupZoom(...args),
        stripImageGenerationMeta:(...args)=>stripImageGenerationMeta(...args),
        thumbDisplaySize:(...args)=>thumbDisplaySize(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args),
        viewportCenter:(...args)=>viewportCenter(...args)
    };
}
function createNode(x, y, images=[], options={}){
    return SmartNodeEdit.createNode(smartNodeEditHost(), x, y, images, options);
}
function createPromptNode(x, y, options={}){
    return SmartNodeEdit.createPromptNode(smartNodeEditHost(), x, y, options);
}
function createLoopNode(x, y, options={}){
    return SmartNodeEdit.createLoopNode(smartNodeEditHost(), x, y, options);
}

function createSmartGroupNode(x, y, options={}){
    return SmartNodeEdit.createSmartGroupNode(smartNodeEditHost(), x, y, options);
}
function cloneSmartNode(node, dx=0, dy=0){
    return SmartNodeEdit.cloneSmartNode(smartNodeEditHost(), node, dx, dy);
}
function smartNodesWithGroupMembers(ids){
    return SmartNodeEdit.smartNodesWithGroupMembers(smartNodeEditHost(), ids);
}
function copySelectedNodes(){
    return SmartNodeEdit.copySelectedNodes(smartNodeEditHost());
}
function pasteNodes(){
    return SmartNodeEdit.pasteNodes(smartNodeEditHost());
}
// 跨页"素材库 → 画布"剪贴板：素材库管理页把所选素材写进这个 localStorage key，
// 画布里按 Ctrl+V 读取并批量生成图片节点（网格平铺），用完即清空（一次性）。
const SMART_CANVAS_ASSET_INBOX_KEY = 'smart_canvas_asset_inbox';
function readAssetInbox(){
    try {
        const data = JSON.parse(localStorage.getItem(SMART_CANVAS_ASSET_INBOX_KEY) || 'null');
        const items = Array.isArray(data?.items) ? data.items.filter(it => it && it.url) : [];
        if(!items.length) return null;
        if(data.ts && (Date.now() - Number(data.ts)) > 30 * 60 * 1000) return null; // 30 分钟内有效
        return items;
    } catch(e){ return null; }
}
function pasteAssetsFromInbox(){
    const items = readAssetInbox();
    if(!items) return false;
    const center = lastMouseWorld || viewportCenter();
    const cell = 260; // 网格间距（世界坐标）
    const cols = Math.max(1, Math.min(items.length, Math.ceil(Math.sqrt(items.length))));
    const rows = Math.ceil(items.length / cols);
    const startX = center.x - (cols - 1) * cell / 2;
    const startY = center.y - (rows - 1) * cell / 2;
    pushUndo();
    const created = [];
    items.forEach((it, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const p = {x: startX + c * cell, y: startY + r * cell};
        const node = createImageNodeAt(p, [assetNodeImageFromItem(it)], {skipUndo:true, select:false});
        if(node) created.push(node.id);
    });
    selectedId = created.length === 1 ? created[0] : '';
    selectedIds = created.length > 1 ? created : [];
    selectedImage = {nodeId:'', index:-1};
    lastNodePasteAt = Date.now();
    try { localStorage.removeItem(SMART_CANVAS_ASSET_INBOX_KEY); } catch(e){}
    render();
    scheduleSave();
    toast(`已粘贴 ${created.length} 个素材到画布`);
    return true;
}
function duplicateForAltDrag(node, preserveConnections=false){
    return SmartNodeEdit.duplicateForAltDrag(smartNodeEditHost(), node, preserveConnections);
}
function shellPoint(event){
    const rect = shell.getBoundingClientRect();
    return {x:event.clientX - rect.left, y:event.clientY - rect.top};
}
function smartConnectionLayerHost(){
    return {
        get canvas(){return canvas;},
        get connectionLayerRaf(){return connectionLayerRaf;},
        set connectionLayerRaf(value){connectionLayerRaf=value;},
        get document(){return document;},
        get loopInsertPreview(){return loopInsertPreview;},
        get nodes(){return nodes;},
        get smartCascadeRunPath(){return smartCascadeRunPath;},
        get world(){return world;},
        bindConnectionEvents:(...args)=>bindConnectionEvents(...args),
        cascadeConnectionKeys:(...args)=>cascadeConnectionKeys(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        nodeRect:(...args)=>nodeRect(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        selectedNodeIds:(...args)=>selectedNodeIds(...args),
        smartCascadeEdgeState:(...args)=>smartCascadeEdgeState(...args)
    };
}
function renderConnections(){
    return SmartConnectionLayer.renderConnections(smartConnectionLayerHost());
}
function refreshConnectionLayer(){
    return SmartConnectionLayer.refreshConnectionLayer(smartConnectionLayerHost());
}
function scheduleConnectionLayerRefresh(){
    return SmartConnectionLayer.scheduleConnectionLayerRefresh(smartConnectionLayerHost());
}
function smartInteractionViewHost(){
    return {
        get dragState(){return dragState;},
        get nodes(){return nodes;},
        get world(){return world;},
        get CSS(){return CSS;},
        get window(){return window;},
        get SMART_GROUP_MAX_VISIBLE_ROWS(){return SMART_GROUP_MAX_VISIBLE_ROWS;},
        get MEDIA_GROUP_MAX_VISIBLE_ROWS(){return MEDIA_GROUP_MAX_VISIBLE_ROWS;},
        captureCanvasContext:()=>smartMediaInputController.capture(),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        cancelAnimationFrame:(...args)=>cancelAnimationFrame(...args),
        refreshConnectionLayer:(...args)=>refreshConnectionLayer(...args),
        renderMinimap:(...args)=>renderMinimap(...args),
        selectedNode:(...args)=>selectedNode(...args),
        positionComposerForNode:(...args)=>positionComposerForNode(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        smartGroupImageRefs:(...args)=>smartGroupImageRefs(...args),
        imageLayout:(...args)=>imageLayout(...args),
        nodeScale:(...args)=>nodeScale(...args),
        render:(...args)=>render(...args),
        smartGroupCompactMembers:(...args)=>smartGroupCompactMembers(...args),
        applyThumbDisplaySizeToElement:(...args)=>applyThumbDisplaySizeToElement(...args),
        scheduleInteractionLayerRefresh:(...args)=>scheduleInteractionLayerRefresh(...args),
        syncSelectionGroup:(...args)=>syncSelectionGroup(...args)
    };
}
const smartInteractionView=SmartNodeView.createInteractionRefresh(smartInteractionViewHost);
function scheduleInteractionLayerRefresh(){
    return smartInteractionView.schedule();
}
function moveNodeElementsDuringDrag(){
    return SmartNodeView.moveNodeElementsDuringDrag(smartInteractionViewHost());
}
function updateNodeElementDuringResize(node){
    return SmartNodeView.updateNodeElementDuringResize(smartInteractionViewHost(), node);
}
function syncSmartGroupMemberElements(group){
    return SmartNodeView.syncSmartGroupMemberElements(smartInteractionViewHost(), group);
}

function isVideoMediaItem(img){
    if(!img) return false;
    if(img.kind === 'video') return true;
    const url = smartOriginalMediaUrl(img).toLowerCase();
    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(url);
}
function isInlineVideoActive(img){
    return Boolean(img && img._inlineVideoActive);
}
function isAudioMediaItem(img){
    if(!img) return false;
    if(img.kind === 'audio') return true;
    const url = smartOriginalMediaUrl(img).toLowerCase();
    return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(url);
}
function isTextMediaItem(img){
    if(!img) return false;
    if(img.kind === 'text') return true;
    const url = smartOriginalMediaUrl(img).toLowerCase();
    return /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(url);
}
function isFileMediaItem(img){
    if(!img) return false;
    return img.kind === 'file';
}
function mediaKindForFile(file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if(type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(name)) return 'video';
    if(type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name)) return 'audio';
    if(type.startsWith('text/') || /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(name)) return 'text';
    return 'image';
}
function mediaKindForItem(img){
    if(isFileMediaItem(img)) return 'file';
    if(isTextMediaItem(img)) return 'text';
    if(isAudioMediaItem(img)) return 'audio';
    if(isVideoMediaItem(img)) return 'video';
    return 'image';
}
function localDisplayUrlForMediaItem(img){
    if(!img) return '';
    const candidates = [
        img.originalLocalUrl,
        img.localUrl,
        img.sourceUrl,
        img.local_url,
        img.source_url,
        img.url
    ];
    const local = candidates.find(url => url && !/^https?:\/\//i.test(String(url)));
    return local || img.url || '';
}
function imageForDisplay(img){
    if(!img || typeof img !== 'object') return img;
    const localUrl = localDisplayUrlForMediaItem(img);
    if(!localUrl || localUrl === img.url) return img;
    return {
        ...img,
        url:localUrl,
        originalLocalUrl:img.originalLocalUrl || localUrl
    };
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
                if(url){
                    const item = {url, kind:value.kind || value.type || value.mediaKind || '', name:value.name || value.filename || ''};
                    ['natural_w','natural_h','width','height','w','h','layout_w','layout_h'].forEach(key => {
                        const n = Number(value[key]);
                        if(Number.isFinite(n) && n > 0) item[key] = n;
                    });
                    urls.push(item);
                }
            }
            ['image_items','media_items','items','outputs','videos','images','urls','data','result'].forEach(key => add(value[key]));
            ['url','path','src','uri','output','output_url','outputUrl','video','video_url','videoUrl','mp4_url','mp4Url','download_url','downloadUrl','preview_url','previewUrl'].forEach(key => add(value[key]));
        }
    };
    add(result);
    ['image_items','media_items','items','outputs','videos','audios','texts','files','images','urls','data','result','output','url'].forEach(key => add(result?.[key]));
    const seen = new Set();
    return urls.map(item => {
        const url = typeof item === 'string' ? item : item?.url || item?.path || '';
        if(!url) return null;
        return typeof item === 'object' ? {...item, url} : url;
    }).filter(item => {
        const url = typeof item === 'string' ? item : item?.url || '';
        return url && !seen.has(url) && seen.add(url);
    });
}
function mediaKindForUrls(urls, fallback='image'){
    const items = (urls || []).map(item => typeof item === 'string' ? {url:item} : (item || {}));
    if(fallback && fallback !== 'image') return fallback;
    if(items.some(isVideoMediaItem)) return 'video';
    if(items.some(isAudioMediaItem)) return 'audio';
    if(items.some(isTextMediaItem)) return 'text';
    return fallback;
}
function imageRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'image').slice(0, SMART_REFERENCE_IMAGE_MAX);
}
function looksLikeImageMediaUrl(url){
    const text = String(url || '').trim().toLowerCase();
    if(!text) return false;
    if(text.startsWith('data:image/')) return true;
    if(text.startsWith('asset://')) return false;
    const path = text.split('?', 1)[0].split('#', 1)[0];
    return /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(path);
}
function videoRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'video' && !looksLikeImageMediaUrl(ref.url));
}
function isRemoteVideoReferenceUrl(url){
    return /^https?:\/\//i.test(String(url || '')) || /^asset:\/\//i.test(String(url || ''));
}
function audioRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'audio');
}
function thumbMediaHtml(img){
    if(isFileMediaItem(img) || isTextMediaItem(img)) return `<div class="media-thumb file-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="${escapeAttr(mediaKindForItem(img))}"><i data-lucide="${isTextMediaItem(img) ? 'file-text' : 'file'}"></i><span>${escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'))}</span></div>`;
    if(isAudioMediaItem(img)) return `<div class="media-thumb audio-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="audio"><i data-lucide="file-audio"></i><span>${escapeHtml(img.name || 'Audio')}</span></div>`;
    if(isVideoMediaItem(img)) return `<div class="media-thumb video-thumb">${isInlineVideoActive(img) ? smartVideoPlayerHtml(img.url || '') : `${smartVideoPreviewHtml(img, 512, 'alt=""')}<button class="smart-video-play thumb-video-play" type="button" title="播放"><i data-lucide="play"></i></button>`}</div>`;
    return smartPreviewImgHtml(img, 512, 'draggable="false"');
}
function imageResolutionLabel(img){
    const w = Number(img?.natural_w || img?.width || img?.w || 0);
    const h = Number(img?.natural_h || img?.height || img?.h || 0);
    return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';
}
function imageResolutionBadgeHtml(img){
    const label = imageResolutionLabel(img);
    return label ? `<span class="image-resolution-badge">${escapeHtml(label)}</span>` : '';
}
function imageNameLabel(img, fallback='image'){
    const raw = String(img?.name || fileNameFromUrl(img?.url || '') || fallback || 'image').trim();
    return raw || 'image';
}
function imageNameBadgeHtml(img, options={}){
    if(!img?.url) return '';
    const label = imageNameLabel(img);
    const outsideClass = options.outside ? ' image-name-badge-outside' : '';
    return `<span class="image-name-badge${outsideClass}" data-image-name="1" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`;
}
function thumbDisplaySize(img, maxSize){
    const limit = Math.max(28, Math.round(Number(maxSize) || 96));
    const size = mediaLayoutSize(img);
    const w = size.width;
    const h = size.height;
    if(!(w > 0 && h > 0)) return {width:limit, height:limit};
    const fit = Math.min(limit / w, limit / h);
    return {
        width:Math.max(28, Math.round(w * fit)),
        height:Math.max(28, Math.round(h * fit))
    };
}
function thumbItemStyle(img, maxSize){
    const size = thumbDisplaySize(img, maxSize);
    return `--thumb-w:${size.width}px;--thumb-h:${size.height}px`;
}
function applyThumbDisplaySizeToElement(itemEl, img, maxSize=0){
    if(!itemEl?.classList?.contains('thumb-item')) return;
    const limit = Math.max(
        28,
        Math.round(
            Number(maxSize || 0)
            || Number(itemEl.style.getPropertyValue('--thumb-size').replace('px', ''))
            || Math.max(itemEl.clientWidth || 0, itemEl.clientHeight || 0)
            || 96
        )
    );
    const size = thumbDisplaySize(img, limit);
    itemEl.style.setProperty('--thumb-w', `${size.width}px`);
    itemEl.style.setProperty('--thumb-h', `${size.height}px`);
}
function updateImageResolutionBadgeElement(itemEl, img){
    if(!itemEl) return;
    const label = imageResolutionLabel(img);
    let badge = itemEl.querySelector('.image-resolution-badge');
    if(!label){
        badge?.remove();
        return;
    }
    if(!badge){
        badge = document.createElement('span');
        badge.className = 'image-resolution-badge';
        itemEl.appendChild(badge);
    }
    badge.textContent = label;
}
function singleMediaHtml(img, w, h){
    if(isFileMediaItem(img) || isTextMediaItem(img)) return `<div class="node-img media-card media-file-card" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="${isTextMediaItem(img) ? 'file-text' : 'file'}"></i></div><div class="media-card-title">${escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'))}</div><div class="media-card-sub">${isTextMediaItem(img) ? 'TEXT' : 'FILE'}</div></div>`;
    if(isAudioMediaItem(img)) return `<div class="node-img media-card media-audio-card" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="file-audio"></i></div><div class="media-card-title">${escapeHtml(img.name || 'Audio')}</div><div class="media-card-sub">AUDIO</div><audio src="${escapeAttr(img.url || '')}" data-url="${escapeAttr(img.url || '')}" controls preload="metadata"></audio></div>`;
    if(isVideoMediaItem(img)) return `<div class="node-img media-card media-video-card" style="width:${w}px;height:${h}px">${isInlineVideoActive(img) ? smartVideoPlayerHtml(img.url || '') : `${smartVideoPreviewHtml(img, 768, 'alt=""')}<button class="smart-video-play" type="button" title="播放"><i data-lucide="play"></i></button>`}</div>`;
    return smartPreviewImgHtml(img, 768, `class="node-img" draggable="false" style="width:${w}px;height:${h}px"`);
}
function smartNodeHasLiveMedia(node){
    return Boolean((!node?.pending && (node?.images || []).some(img => img?.url)));
}
function mediaSignaturePartFromElement(itemEl){
    if(itemEl?.dataset?.mediaSignature) return itemEl.dataset.mediaSignature;
    const media = itemEl?.querySelector?.('video,audio,img');
    if(media){
        const tag = media.tagName.toLowerCase();
        const kind = tag === 'video' ? 'video' : tag === 'audio' ? 'audio' : 'image';
        const url = media.dataset?.url || media.dataset?.originalSrc || media.getAttribute('src') || '';
        return `${kind}:${url}`;
    }
    const audioThumb = itemEl?.querySelector?.('.audio-thumb[data-media-url]');
    if(audioThumb) return `audio:${audioThumb.dataset.mediaUrl || ''}`;
    return '';
}
function smartMediaPlaybackHost(){
    return {
        get world(){return world;},
        get nodes(){return nodes;},
        get window(){return window;},
        captureCanvasContext:()=>smartMediaInputController.capture(),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        cancelAnimationFrame:(...args)=>cancelAnimationFrame(...args)
    };
}
const smartMediaPlayback=SmartMediaPlayback.create(smartMediaPlaybackHost);
function captureMediaPlaybackState(media){
    return smartMediaPlayback.captureMediaPlaybackState(media);
}
function restoreMediaPlaybackState(media, state){
    return smartMediaPlayback.restoreMediaPlaybackState(media, state);
}
function transplantSmartMediaElements(oldNodeEl, newNodeEl){
    return smartMediaPlayback.transplantSmartMediaElements(oldNodeEl, newNodeEl);
}
function captureMediaPlaybackStates(){
    return smartMediaPlayback.captureMediaPlaybackStates();
}
function restoreMediaPlaybackStates(states){
    return smartMediaPlayback.restoreMediaPlaybackStates(states);
}
function smartRunTaskLabel(run){
    const s = run?.settings || {};
    if(s.engine === 'runninghub') return s.rhTaskLabel || s.rhWorkflowTitle || s.rhAppTitle || s.rhWorkflowId || s.rhAppId || 'RunningHub';
    if(run?.kind === 'video') return s.videoModel || 'Video';
    if(s.engine === 'comfy'){
        if(s.comfyMode === 'custom') return s.comfyWorkflow || 'ComfyUI';
        const labels = {text:tr('canvas.comfyModeText') || '文生图', enhance:tr('canvas.comfyModeEnhance') || '图片增强', edit:tr('canvas.comfyModeEdit') || '图片编辑'};
        return labels[s.comfyMode || 'text'] || 'ComfyUI';
    }
    if(s.engine === 'modelscope'){
        return s.msgenModel === 'custom' ? (s.msCustomModel || 'Modelscope') : (MS_GEN_MODELS[s.msgenModel]?.label || s.msgenModel || 'Modelscope');
    }
    return s.model || 'API Image';
}
function outputUrlLooksVideo(url){
    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(smartOriginalMediaUrl(url).toLowerCase());
}
function proxiedMediaUrl(itemOrUrl, name=''){
    return CanvasMediaSources.proxiedMediaUrl(smartMediaSourceHost(), itemOrUrl, name);
}
function displayMediaUrl(itemOrUrl, name=''){
    return CanvasMediaSources.displayMediaUrl(smartMediaSourceHost(), itemOrUrl, name);
}
function bindImageProxyFallback(imgEl, itemOrUrl){
    return smartImageResolution.bindProxy(imgEl,itemOrUrl);
}
function safeExportFileName(name, fallback='download.zip'){
    const cleaned = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim();
    return cleaned || fallback;
}
function fileNameFromUrl(url=''){
    return CanvasMediaSources.fileNameFromUrl(smartMediaSourceHost(), url);
}
function extensionForMediaItem(item, fallback='.png'){
    const source = [item?.name, item?.url].map(value => String(value || '').split('?')[0].split('#')[0]).find(value => /\.[a-z0-9]{2,8}$/i.test(value));
    if(source) return source.match(/(\.[a-z0-9]{2,8})$/i)?.[1] || fallback;
    const kind = mediaKindForItem(item);
    if(kind === 'video') return '.mp4';
    if(kind === 'audio') return '.mp3';
    if(kind === 'text') return '.txt';
    return fallback;
}
function downloadNameForMediaItem(item, fallbackPrefix='canvas-output'){
    const localName = fileNameFromUrl(item?.url || '');
    const preferred = localName || item?.name || '';
    const ext = extensionForMediaItem(item);
    const randomName = `${fallbackPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}${ext}`;
    let name = safeExportFileName(preferred || randomName, randomName);
    if(!/\.[a-z0-9]{2,8}$/i.test(name)) name += ext;
    return name;
}
function downloadPreviewImage(){
    const node = nodes.find(n => n.id === previewNavState.nodeId);
    const image = node?.images?.[previewNavState.index];
    if(!image?.url) return;
    const name = downloadNameForMediaItem(image, 'image');
    const link = document.createElement('a');
    link.href = `/api/download-output?url=${encodeURIComponent(image.url)}&name=${encodeURIComponent(name)}`;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function downloadPreviewFile(item){
    if(!item?.url) return;
    const name = downloadNameForMediaItem(item, 'output');
    const link = document.createElement('a');
    link.href = `/api/download-output?url=${encodeURIComponent(item.url)}&name=${encodeURIComponent(name)}`;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function previewDownloadGroupItems(){
    // 分组预览：整组所有成员图片按阅读顺序打包。
    if(previewNavState.groupId){
        const group = nodes.find(n => n.id === previewNavState.groupId && isSmartGroupNode(n));
        if(group) return smartGroupImageRefs(group).map((r, index) => ({...r.item, __index:index}));
    }
    const node = nodes.find(n => n.id === previewNavState.nodeId);
    return (node?.images || [])
        .filter(item => item?.url)
        .map((item, index) => ({...item, __index:index}))
        .sort((a, b) => {
            const ga = a.grid || {};
            const gb = b.grid || {};
            const rowDiff = Number(ga.row ?? a.__index) - Number(gb.row ?? b.__index);
            if(rowDiff) return rowDiff;
            const colDiff = Number(ga.col ?? a.__index) - Number(gb.col ?? b.__index);
            return colDiff || a.__index - b.__index;
        });
}
// 把一组图片打包成 zip 下载（预览“下载全部”和分组小菜单“批量下载”共用）。
async function zipDownloadImageItems(title, items){
    const list = (items || []).filter(item => item?.url);
    if(!list.length) return;
    try {
        const filename = safeExportFileName(`${title || 'image-group'}.zip`, 'image-group.zip');
        const response = await fetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                filename,
                urls:list.map(item => item.url).filter(Boolean),
                items:list.map((item, index) => ({url:item.url, name:downloadNameForMediaItem(item, `image-${String(index + 1).padStart(2, '0')}`)}))
            })
        });
        if(!response.ok) throw new Error((await response.text()) || '批量下载失败');
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1200);
    } catch(e) {
        toast((e.message || '批量下载失败').slice(0, 160));
    }
}
async function downloadPreviewGroup(){
    const group = previewNavState.groupId ? nodes.find(n => n.id === previewNavState.groupId) : null;
    const owner = group || nodes.find(n => n.id === previewNavState.nodeId);
    return zipDownloadImageItems(owner?.title, previewDownloadGroupItems());
}
function downloadSmartGroupImages(group){
    if(!isSmartGroupNode(group)) return;
    return zipDownloadImageItems(group?.title, smartGroupImageRefs(group).map(r => r.item));
}
function smartRunPlatformLabel(run){
    const s = run?.settings || {};
    if(s.engine === 'comfy') return 'ComfyUI';
    if(s.engine === 'runninghub') return 'RunningHub';
    if(s.engine === 'modelscope') return 'Modelscope';
    if(run?.kind === 'video') return videoProviderById(s.videoProvider || '')?.name || s.videoProvider || 'Video';
    return apiProviderById(s.provider_id || '')?.name || s.provider_id || 'API';
}
function smartRunRequestMeta(run){
    if(run?.audioRequest) return {...run.audioRequest};
    const s = run?.settings || {};
    if(s.engine === 'comfy') return {workflow_json:s.comfyWorkflow || '', mode:s.comfyMode || 'text'};
    if(s.engine === 'runninghub') return {
        workflow_id:s.rhWorkflowId || '',
        webapp_id:s.rhAppId || '',
        task_id:s.rhTaskId || '',
        mode:s.rhMode || 'workflow',
        duration:s.duration || '',
        aspect_ratio:s.aspectRatio || '',
        megapixels:s.megapixels || '',
        refs:s.refCount || 0
    };
    if(s.engine === 'modelscope') return {backend:'Modelscope', model:s.msgenModel || '', custom_model:s.msCustomModel || ''};
    if(run?.kind === 'video') return {provider_id:s.videoProvider || '', model:s.videoModel || '', duration:s.videoDuration || '', aspect_ratio:s.videoAspect || '', resolution:s.videoResolution || ''};
    return {provider_id:s.provider_id || '', model:s.model || '', size:run?.size || '', quality:s.quality || '', n:s.count || 1};
}
function smartRunSnapshot(node, prompt, refs=[], kind='image'){
    const settingsSnapshot = cloneSmartSettings(settings);
    return {
        nodeId:node?.id || '',
        nodeType:node?.type || 'smart-image',
        kind,
        settings:settingsSnapshot,
        prompt:prompt || '',
        refs:(refs || []).map(ref => ({url:ref.url || '', name:ref.name || 'image', kind:ref.kind || ''})).filter(ref => ref.url),
        size: kind === 'image' && isApiLikeEngine(settingsSnapshot.engine) ? sizeForRun(settingsSnapshot) : ''
    };
}
function smartLogHost(){
    return {
        get SMART_LOG_PREVIEW_NODE_ID(){return SMART_LOG_PREVIEW_NODE_ID;},
        get canvas(){return canvas;},
        get canvasId(){return canvasId;},
        get document(){return document;},
        get escapeAttr(){return escapeAttr;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get smartLogList(){return smartLogList;},
        get smartLogModal(){return smartLogModal;},
        get smartLogPreviewRestore(){return smartLogPreviewRestore;},
        set smartLogPreviewRestore(value){smartLogPreviewRestore=value;},
        get smartSaveScheduler(){return smartSaveScheduler;},
        get window(){return window;},
        bindSmartPreviewImageFallbacks:(...args)=>bindSmartPreviewImageFallbacks(...args),
        confirm:(...args)=>confirm(...args),
        copyMediaSizeFields:(...args)=>copyMediaSizeFields(...args),
        copyTextToClipboard:(...args)=>copyTextToClipboard(...args),
        displayMediaUrl:(...args)=>displayMediaUrl(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        formatRunDuration:(...args)=>formatRunDuration(...args),
        imageResolutionLabel:(...args)=>imageResolutionLabel(...args),
        outputUrlLooksVideo:(...args)=>outputUrlLooksVideo(...args),
        parseSizeValue:(...args)=>parseSizeValue(...args),
        playGenerationCompleteSound:(...args)=>playGenerationCompleteSound(...args),
        recoverStuckLoopOutputsFromLogs:(...args)=>recoverStuckLoopOutputsFromLogs(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        render:(...args)=>render(...args),
        resultMediaUrls:(...args)=>resultMediaUrls(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartMediaPreviewUrl:(...args)=>smartMediaPreviewUrl(...args),
        smartPreviewImgHtml:(...args)=>smartPreviewImgHtml(...args),
        smartRunPlatformLabel:(...args)=>smartRunPlatformLabel(...args),
        smartRunRequestMeta:(...args)=>smartRunRequestMeta(...args),
        smartRunTaskLabel:(...args)=>smartRunTaskLabel(...args),
        smartVideoPreviewHtml:(...args)=>smartVideoPreviewHtml(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function addSmartGenerationLog({run, outputs=[], runMs=0, error=''}){
    return SmartLog.addSmartGenerationLog(smartLogHost(), arguments[0]);
}
const SMART_LOG_PREVIEW_NODE_ID = '__smart_log_preview__';
let smartLogPreviewRestore = null;
function smartLogOutputItem(output){
    return SmartLog.smartLogOutputItem(smartLogHost(), output);
}
function normalizedSizeLabel(value){
    return SmartLog.normalizedSizeLabel(smartLogHost(), value);
}
function smartLogSizeSummary(log, outputs=[]){
    return SmartLog.smartLogSizeSummary(smartLogHost(), log, outputs);
}
// 移除临时预览节点并还原选中态。供 closeImageEditor 调用。
function cleanupSmartLogPreviewNode(){
    return SmartLog.cleanupSmartLogPreviewNode(smartLogHost());
}
function closeSmartLogLightbox(){
    return SmartLog.closeSmartLogLightbox(smartLogHost());
}
// 日志缩略图的轻量预览：只弹一张大图（不进编辑器那套裁剪/涂抹的重组件），点背景或关闭按钮即关。
function openSmartLogLightbox(url, kind='image'){
    return SmartLog.openSmartLogLightbox(smartLogHost(), url, kind);
}
function smartLogPreviewNode(url, kind='image'){
    return SmartLog.smartLogPreviewNode(smartLogHost(), url, kind);
}
async function deleteCanvasLogEntry(logId, deleteMedia=false){
    return SmartLog.deleteCanvasLogEntry(smartLogHost(), logId, deleteMedia);
}
function renderSmartCanvasLog(){
    return SmartLog.renderSmartCanvasLog(smartLogHost());
}
function openSmartCanvasLog(){
    return SmartLog.openSmartCanvasLog(smartLogHost());
}
function closeSmartCanvasLog(){
    return SmartLog.closeSmartCanvasLog(smartLogHost());
}
function openSmartCanvasShortcuts(){
    smartShortcutModal?.classList.add('open');
    refreshIcons();
}
function closeSmartCanvasShortcuts(){
    smartShortcutModal?.classList.remove('open');
}
function promptNodeBodyHtml(node){
    return SmartNodeBody.promptNodeBodyHtml(smartNodeViewHost(), node);
}
function refreshPromptNodeSegmentsUi(el, node){
    return SmartNodeBindings.refreshPromptNodeSegmentsUi(smartNodeViewHost(), el, node);
}
function loopNumberControlHtml({label, value, key, min=1, max=100, quick=[1,2,3,4,5,6,8,10]}){
    const v = Math.max(min, Math.min(max, Number(value) || min));
    return `<div class="loop-number-control">
        <button class="loop-smart-control loop-number-trigger" type="button"><span>${escapeHtml(label)}</span><strong>${v}</strong></button>
        <div class="loop-number-popover">
            <div class="loop-number-grid">
                ${quick.map(n => `<button type="button" class="loop-smart-control loop-number-cell ${n === v ? 'active' : ''}" data-loop-number="${escapeHtml(key)}" data-loop-value="${n}">${n}</button>`).join('')}
            </div>
            <label class="loop-number-custom">
                <span>${escapeHtml(tr('common.custom'))}</span>
                <input class="loop-smart-control loop-number-input" type="number" min="${min}" max="${max}" step="1" data-loop-number-input="${escapeHtml(key)}" value="${v}">
            </label>
        </div>
    </div>`;
}
function smartLoopTokenLabel(token){
    if(token === '《计数》' || token === '[计数]') return tr('canvas.counterToken');
    return token;
}
function smartLoopTokenChipHtml(token){
    return `<span class="loop-smart-token-chip" contenteditable="false" data-token="${escapeHtml(token)}"><span>${escapeHtml(smartLoopTokenLabel(token))}</span><button type="button" aria-label="${escapeHtml(tr('common.delete'))}" title="${escapeHtml(tr('common.delete'))}">×</button></span>`;
}



































function smartLoopVariableHtml(text){
    return String(text || '').split(/(《计数》|\[计数\])/g).map(part => {
        if(part === '《计数》' || part === '[计数]') return smartLoopTokenChipHtml('《计数》');
        return escapeHtml(part);
    }).join('');
}
function smartLoopEditorText(editor){
    const walk = node => {
        if(node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if(node.nodeType !== Node.ELEMENT_NODE) return '';
        if(node.classList?.contains('loop-smart-token-chip')) return node.dataset.token || '';
        if(node.tagName === 'BR') return '\n';
        return [...node.childNodes].map(walk).join('');
    };
    return [...(editor?.childNodes || [])].map(walk).join('').replace(/\u00a0/g, ' ');
}
function insertSmartLoopToken(editor, token){
    if(!editor) return;
    editor.focus();
    const chipWrap = document.createElement('span');
    chipWrap.innerHTML = smartLoopTokenChipHtml(token);
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
function smartLoopBodyHtml(node){
    return SmartNodeBody.smartLoopBodyHtml(smartNodeViewHost(), node);
}
function smartGroupBodyHtml(node){
    return SmartNodeBody.smartGroupBodyHtml(smartNodeViewHost(), node);
}


function nodeBodyHtml(node, layout){
    return SmartNodeBody.nodeBodyHtml(smartNodeViewHost(), node, layout);
}
function nodeMediaBodyHtml(node, layout){
    return SmartNodeBody.nodeMediaBodyHtml(smartNodeViewHost(), node, layout);
}
function jimengPendingBodyHtml(node, layout){
    return SmartNodeBody.jimengPendingBodyHtml(smartNodeViewHost(), node, layout);
}
function smartRecoverableImageTask(node){
    return smartPendingTasks(node).find(task => task.queryPaused || (task.failed && (task.recoverTaskId || task.kind === 'video'))) || null;
}
function imageTaskRecoverBodyHtml(node, task, layout){
    return SmartNodeBody.imageTaskRecoverBodyHtml(smartNodeViewHost(), node, task, layout);
}
function smartNodeToolbarImageIndex(node){
    const images = node?.images || [];
    if(selectedImage.nodeId === node?.id){
        const index = Number(selectedImage.index);
        if(Number.isFinite(index) && index >= 0 && index < images.length) return index;
    }
    return 0;
}
function smartNodeToolbarHtml(node){
    return SmartNodeBody.smartNodeToolbarHtml(smartNodeViewHost(), node);
}
function remapSmartViewAdjustRefs(node, idMap, preserveExternal=false){
    if(!node.viewAdjust) return;
    const remap = id => idMap.get(id) || (preserveExternal ? id : '');
    node.viewAdjust.sourceNodeId = remap(node.viewAdjust.sourceNodeId);
    node.blockedInputRefs = (node.blockedInputRefs || []).map(key => {
        const split = key.lastIndexOf('|'), sourceId = remap(key.slice(0,split));
        return sourceId ? `${sourceId}${key.slice(split)}` : '';
    }).filter(Boolean);
}
function createSmartViewAdjustApiNode(source, imageIndex, compiled){
    const item=imageForDisplay(source?.images?.[imageIndex]);
    if(!item?.url)throw new Error('原图片已删除或改变，请重新打开');
    pushUndo();
    const point=nextOutputPositionForSource(source,{w:EMPTY_UPLOAD_NODE_WIDTH,h:EMPTY_UPLOAD_NODE_HEIGHT});
    const target=createImageNodeAt({x:point.x+EMPTY_UPLOAD_NODE_WIDTH/2,y:point.y+EMPTY_UPLOAD_NODE_HEIGHT/2},[],{select:false,skipUndo:true});
    target.runSettings={...cloneSmartSettings(smartSettingsForNode(source)),engine:'api',apiKind:'image',count:1,ratio:'source'};
    if(compiled.selection){target.runSettings.provider_id=compiled.selection.providerId;target.runSettings.model=compiled.selection.model;}
    target.viewAdjust={kind:compiled.kind,sourceNodeId:source.id,sourceImageIndex:imageIndex,sourceUrl:item.url,params:compiled.params,title:compiled.title};
    target.blockedInputRefs=(source.images || []).map((_,index)=>index===imageIndex?'':`${source.id}|${index}`).filter(Boolean);
    setPromptDraftForNode(target,compiled.prompt);
    target.runPrompt=compiled.prompt;
    connectInputNode(source.id,target.id);
    // Flush the previous composer's draft before changing its target.
    savePromptDraftForCurrent();
    activeComposerSubject=null;
    lastComposerNodeId='';
    selectedId=target.id;
    selectedIds=[];
    selectedImage={nodeId:'',index:-1};
    render();
    scheduleSave();
    return target;
}
function openSmartViewAdjustment(nodeId, kind){
    const source=nodes.find(node=>node.id===nodeId),index=smartNodeToolbarImageIndex(source);
    const item=imageForDisplay(source?.images?.[index]);
    if(!item?.url || mediaKindForItem(item)!=='image')return;
    const sourceUrl=item.url,owner=canvasId;
    const isAlive=()=>canvasId===owner && nodes.some(node=>node.id===nodeId && imageForDisplay(node.images?.[index])?.url===sourceUrl);
    CanvasViewAdjust.open({kind,source:{url:sourceUrl},models:CanvasViewAdjust.configuredModels(imageProviders(),provider=>filterJimengImageModels(providerImageModels(provider.id),provider.id,true)),initial:source.viewAdjustDrafts?.[kind] || {selection:{providerId:source.runSettings?.provider_id,model:source.runSettings?.model}},isAlive,
        onDraft:draft=>{if(!isAlive())return;const live=nodes.find(node=>node.id===nodeId);live.viewAdjustDrafts={...live.viewAdjustDrafts,[kind]:draft};scheduleSave();},
        onSubmit:async compiled=>{
            if(!isAlive())throw new Error('原图片已改变，请重新打开');
            if(compiled.selection && (!imageProviders().some(provider=>provider.id===compiled.selection.providerId) || !filterJimengImageModels(providerImageModels(compiled.selection.providerId),compiled.selection.providerId,true).includes(compiled.selection.model)))throw new Error('API 模型配置已改变，请重新打开调整面板。');
            const live=nodes.find(node=>node.id===nodeId);
            const target=createSmartViewAdjustApiNode(live,index,compiled);
            const box=nodeRect(target);
            const editHeight=box.height+14+composer.offsetHeight, editWidth=Math.max(box.width,composer.offsetWidth);
            viewport.scale=Math.max(0.06,Math.min(Math.max(safeScale(viewport.scale),0.65),1,Math.max(1,shell.clientWidth-96)/editWidth,Math.max(1,shell.clientHeight-120)/editHeight));
            centerViewportOnWorldPoint({x:box.x+box.width/2,y:box.y+editHeight/2});
            const saved=await saveCanvas();
            return {saved,message:saved?'API 节点已创建并保存，提示词和原图已关联；在节点上点击运行即可。':'API 节点已创建，但画布尚未保存。请先重试保存，无需再次创建节点。',nodeId:target.id};
        }
    });
}
function duplicateSmartNodeMediaToCanvas(node, imageIndex){
    const source = node?.images?.[imageIndex];
    const item = imageForDisplay(source);
    if(!node || !item?.url){ toast('没有可导出到画布的素材'); return; }
    pushUndo();
    const rect = nodeRect(node);
    const point = {x:rect.x + rect.width + 220, y:rect.y + rect.height / 2};
    const copy = {...item};
    const newNode = createImageNodeAt(point, [copy], {select:true, skipUndo:true});
    selectedIds = [];
    selectedImage = {nodeId:newNode.id, index:0};
    render();
    scheduleSave();
    toast('已添加到画布');
}
function runSmartNodeToolbarAction(nodeId, action){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const index = smartNodeToolbarImageIndex(node);
    const item = imageForDisplay(node.images?.[index]);
    if(!item?.url) return;
    const kind = mediaKindForItem(item);
    selectedId = nodeId;
    selectedIds = [];
    selectedImage = {nodeId, index};
    if(action === 'download'){
        downloadPreviewFile(node.images?.[index] || item);
        return;
    }
    if(action === 'canvas'){
        duplicateSmartNodeMediaToCanvas(node, index);
        return;
    }
    if(action === 'video-edit' && kind === 'video'){
        openSmartVideoEditor(nodeId, index);
        return;
    }
    if(kind !== 'image' && action !== 'preview'){
        toast('当前素材不支持该操作');
        return;
    }
    if(action === 'preview'){
        openImagePreview(nodeId, index);
        return;
    }
    if(action === 'upscale'){
        runJimengUpscale(node, index);
        return;
    }
    const modeMap = {crop:'crop', outpaint:'outpaint', mask:'mask', brush:'brush', grid:'grid'};
    openImageEditor(nodeId, index);
    setImageEditMode(modeMap[action] || 'preview', true);
    if(action === 'grid' && canGridJoinCurrentNode()){
        setGridOperationMode('join');
    }
}
function smartDepthPair(node){
    const capture = node?.depthCapture;
    return capture ? nodes.filter(item => item.depthCapture?.operationId === capture.operationId) : [];
}
function remapSmartDepthCopies(copies, idMap, preserveExternal=false){
    window.CanvasVideoDeconstructionModel?.remapCopies(copies, idMap);
    const operations = new Map();
    copies.forEach(node => {
        delete node.assistantNativeRun;
        delete node.assistantNativeActionId;
        delete node.assistantMediaExportReceipts;
        delete node.assistantNativeOrigin;
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
            node.pending = 0;
            node.running = false;
        }
    });
}
function latestSmartDepthCapture(sourceId, sourceIndex, sourceUrl){
    return nodes.filter(item => item.depthCapture?.sourceId === sourceId
        && item.depthCapture?.sourceIndex === sourceIndex && item.depthCapture?.sourceUrl === sourceUrl)
        .sort((a,b) => Number(b.depthCapture.createdAt || 0) - Number(a.depthCapture.createdAt || 0))[0]?.depthCapture || null;
}
function openSmartVideoEditor(sourceId, sourceIndex){
    const node = nodes.find(item => item.id === sourceId);
    const item = node?.images?.[sourceIndex];
    if(!item?.url || mediaKindForItem(imageForDisplay(item)) !== 'video') return;
    const sourceUrl = item.url;
    const bridge = window.CanvasVideoDeconstructionBridge;
    const source = bridge?.sourceFor(sourceId, sourceIndex, sourceUrl, item.name || '视频');
    CanvasDepthCapture.open({sourceUrl, title:item.name || '视频',
        extensions:source ? {
            onOpenCuts:() => window.CanvasVideoDeconstructionUI.openCuts(source, bridge),
            onOpenTable:() => window.CanvasVideoDeconstructionUI.openTable(source, bridge)
        } : undefined,
        getCurrent:() => latestSmartDepthCapture(sourceId, sourceIndex, sourceUrl) || {},
        onStart:() => startSmartDepthCapture(sourceId, sourceIndex, sourceUrl),
        onRetry:() => {
            const capture = latestSmartDepthCapture(sourceId, sourceIndex, sourceUrl);
            if(capture) return retrySmartDepthCapture(nodes.find(n => n.depthCapture === capture)?.id);
        },
        onCancel:() => {
            const capture = latestSmartDepthCapture(sourceId, sourceIndex, sourceUrl);
            if(capture) return cancelSmartDepthCapture(nodes.find(n => n.depthCapture === capture)?.id);
        }
    });
}
function updateSmartDepthCapture(pair, task, operationId){
    if(!pair.length || pair[0].depthCapture?.operationId !== operationId) return;
    const old = pair[0].depthCapture;
    const state = {...old, taskId:task.id || old.taskId || '', status:task.status || old.status,
        stage:task.stage || old.stage, error:task.error || '', progress:task.progress || 0,
        result_url:task.result_url || old.result_url || '', pose_url:task.pose_url || old.pose_url || '',
        pose_data_url:task.pose_data_url || old.pose_data_url || '',
        detected_frames:task.detected_frames, total_frames:task.total_frames};
    pair.forEach(node => {
        node.depthCapture = {...state, role:node.depthCapture.role};
        node.pending = ['queued','running','submitting','query-error'].includes(state.status) ? 1 : 0;
        node.running = Boolean(node.pending);
        if(task.status === 'succeeded'){
            const pose = node.depthCapture.role === 'pose';
            node.images = [{url:pose ? state.pose_url : state.result_url, kind:'video',
                name:pose ? '骨骼姿态参考' : '灰度深度参考'}];
            node.title = pose ? '骨骼姿态' : '灰度深度';
        }
    });
    render();
    CanvasDepthCapture.update();
    if(old.taskId !== state.taskId || ['succeeded','failed','cancelled'].includes(state.status)) scheduleSave();
}
function watchSmartDepthCapture(node){
    const capture = node?.depthCapture;
    if(!capture || ['succeeded','failed','cancelled'].includes(capture.status)) return;
    const operationId = capture.operationId;
    CanvasDepthCapture.watch(`smart:${canvasId}:${operationId}`,
        async () => {
            const live = nodes.find(n => n.id === node.id && n.depthCapture?.operationId === operationId);
            if(!live) throw new Error('结果节点已移除');
            return live.depthCapture.taskId
                ? CanvasDepthCapture.get(live.depthCapture.taskId)
                : CanvasDepthCapture.submit(live.depthCapture.sourceUrl, operationId);
        }, task => updateSmartDepthCapture(nodes.filter(n => n.depthCapture?.operationId === operationId), task, operationId));
}
async function saveSmartDepthPlaceholders(){
    for(let attempt=0; attempt<6; attempt++){
        if(await saveCanvas()) return true;
        await new Promise(resolve => setTimeout(resolve, 350));
    }
    return false;
}
async function startSmartDepthCapture(sourceId, sourceIndex, sourceUrl){
    const source = nodes.find(n => n.id === sourceId);
    if(source?.images?.[sourceIndex]?.url !== sourceUrl) throw new Error('原视频已改变，请重新打开编辑面板');
    pushUndo();
    const id = CanvasDepthCapture.operationId();
    const rect = nodeRect(source);
    const base = {sourceId, sourceIndex, sourceUrl, operationId:id, taskId:'',
        status:'submitting', stage:'保存画布并提交任务', error:'', createdAt:Date.now()};
    const depth = createImageNodeAt({x:rect.x + rect.width + 250, y:rect.y + 95}, [], {select:false, skipUndo:true});
    const pose = createImageNodeAt({x:rect.x + rect.width + 250, y:rect.y + 320}, [], {select:false, skipUndo:true});
    depth.depthCapture = {...base, role:'depth'};
    pose.depthCapture = {...base, role:'pose'};
    depth.pending = pose.pending = 1;
    depth.title = '灰度深度'; pose.title = '骨骼姿态';
    connectInputNode(source.id, depth.id);
    connectInputNode(source.id, pose.id);
    render();
    if(!await saveSmartDepthPlaceholders()){
        updateSmartDepthCapture([depth,pose], {status:'failed', stage:'画布保存失败', error:'请保存画布后重试'}, id);
        return;
    }
    watchSmartDepthCapture(depth);
    CanvasDepthCapture.update();
}
async function retrySmartDepthCapture(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node?.depthCapture) return;
    const pair = smartDepthPair(node);
    const id = CanvasDepthCapture.operationId();
    pair.forEach(item => { item.images = []; item.pending = 1; item.depthCapture = {...item.depthCapture,
        operationId:id, taskId:'', status:'submitting', stage:'保存画布并重试', error:'',
        result_url:'', pose_url:'', pose_data_url:'', createdAt:Date.now()}; });
    render();
    if(!await saveSmartDepthPlaceholders()){
        updateSmartDepthCapture(pair, {status:'failed', stage:'画布保存失败', error:'请保存画布后重试'}, id);
        return;
    }
    watchSmartDepthCapture(pair[0]);
}
async function cancelSmartDepthCapture(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node?.depthCapture?.taskId) return;
    const task = await CanvasDepthCapture.cancel(node.depthCapture.taskId);
    updateSmartDepthCapture(smartDepthPair(node), task, node.depthCapture.operationId);
}
function resumeSmartDepthCaptureTasks(){
    nodes.filter(node => node.depthCapture && !['succeeded','failed','cancelled'].includes(node.depthCapture.status))
        .forEach(watchSmartDepthCapture);
}
async function runJimengUpscale(node, index){
    node = liveSmartNode(node) || node;
    const item = imageForDisplay(node?.images?.[index]);
    if(!item?.url || mediaKindForItem(item) !== 'image'){ toast(tr('smart.jimengUpscaleNeedImage')); return; }
    const providerId = jimengImageProviderId();
    if(!providerId){ toast(tr('smart.jimengUpscaleNeedImage')); return; }
    const resolution = JIMENG_UPSCALE_RESOLUTIONS.includes(settings.jimengUpscaleRes) ? settings.jimengUpscaleRes : '2k';
    pushUndo();
    const rect = nodeRect(node);
    const target = createImageNodeAt({x:rect.x + rect.width + 220, y:rect.y + rect.height / 2}, [], {select:true, skipUndo:true});
    target.title = 'Upscale';
    target.runStartedAt = nowMs();
    target.pending = 1;
    target.running = true;
    render();
    try {
        const task = await fetch('/api/canvas-image-tasks', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({prompt:`upscale ${resolution}`, provider_id:providerId, model:'', operation:'upscale', resolution_type:resolution, n:1, reference_images:[{url:item.url, name:item.name || 'upscale-input.png'}]})
        }).then(async response => {
            if(!response.ok) throw new Error(await response.text());
            return response.json();
        });
        if(!task.task_id) throw new Error(tr('smart.errRunFailed'));
        const live = liveSmartNode(target) || target;
        live.pendingTasks = [{taskId:task.task_id, kind:'image', providerId, model:''}];
        live.pending = 1;
        live.running = false;
        render();
        scheduleSave();
        await saveCanvas();
        await resumeSmartPendingNode(live);
    } catch(error) {
        toast((error.message || tr('smart.errRunFailed')).slice(0, 160));
        const live = liveSmartNode(target) || target;
        live.running = false;
        live.pending = 0;
        delete live.pendingTasks;
        if(!(live.images || []).length && !live.jimengPending) nodes = nodes.filter(item => item.id !== live.id);
        render();
        scheduleSave();
    }
}
// 智能分组顶部小菜单：整理排列 / 预览（整组左右切换）/ 宫格拼接 / 批量下载 / 解散分组。
// 与多图节点的 smart-node-floating-menu 同款样式与定位（选中分组时浮在卡片上方）。
function smartGroupToolbarHtml(node){
    return SmartNodeBody.smartGroupToolbarHtml(smartNodeViewHost(), node);
}
function runSmartGroupToolbarAction(nodeId, action){
    const group = nodes.find(n => n.id === nodeId);
    if(!isSmartGroupNode(group)) return;
    selectedId = nodeId;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    if(action === 'arrange'){
        if(arrangeSmartGroupMembers(group)){ render(); scheduleSave(); toast('已整理分组'); }
        else toast('分组内没有可整理的节点');
        return;
    }
    if(action === 'ungroup'){ ungroupNode(nodeId); return; }
    // 图片已收进分组（group.images），预览/下载/拼接直接复用单节点机器（分组就是一个多图容器）。
    const imageCount = (group.images || []).filter(img => img?.url).length;
    if(!imageCount){ toast('分组内没有图片'); return; }
    if(action === 'preview'){
        const first = (group.images || []).findIndex(img => img?.url);
        openImagePreview(nodeId, Math.max(0, first));
        return;
    }
    if(action === 'download'){ zipDownloadImageItems(group.title, (group.images || []).map(imageForDisplay)); return; }
    if(action === 'grid'){
        if(imageCount <= 1){ toast('分组至少需要 2 张图片才能宫格拼接'); return; }
        const first = (group.images || []).findIndex(img => img?.url);
        openImageEditor(nodeId, Math.max(0, first));
        if(imageEditModal.classList.contains('open')){
            setImageEditMode('grid', true);
            setGridOperationMode('join');
        }
        return;
    }
}
function nowMs(){ return Date.now(); }
function formatRunDuration(ms){
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return min ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}
function nodeRunElapsedMs(node){
    if(!node) return 0;
    if(node.runFinishedAt && node.runStartedAt) return Number(node.runElapsedMs) || (Number(node.runFinishedAt) - Number(node.runStartedAt));
    if(node.runStartedAt) return nowMs() - Number(node.runStartedAt);
    return 0;
}
function runTimePillHtml(node){
    if(!node || node.runTimerHidden || node.type === 'smart-prompt') return '';
    const running = Boolean(node.pending || node.running || node.jimengPending);
    if(!running && !node.runFinishedAt) return '';
    const cls = running ? '' : ' done';
    return `<span class="run-time-pill${cls}" data-run-timer="${escapeHtml(node.id)}">${formatRunDuration(nodeRunElapsedMs(node))}</span>`;
}
function hideRunTimerForNode(node){
    if(!node || node.runTimerHidden || node.pending || node.running || node.jimengPending || !node.runFinishedAt) return false;
    node.runTimerHidden = true;
    scheduleSave();
    return true;
}
function refreshRunTimerPills(){
    const active = nodes.some(n => n.type !== 'smart-prompt' && !n.runTimerHidden && (n.pending || n.running || n.jimengPending || n.runFinishedAt));
    document.querySelectorAll('[data-run-timer]').forEach(el => {
        const node = nodes.find(n => n.id === el.dataset.runTimer);
        if(!node || node.runTimerHidden || node.type === 'smart-prompt') {
            el.remove();
            return;
        }
        el.textContent = formatRunDuration(nodeRunElapsedMs(node));
        el.classList.toggle('done', Boolean(!node.pending && !node.running && !node.jimengPending && node.runFinishedAt));
    });
    if(active && !runTimerInterval) runTimerInterval = setInterval(refreshRunTimerPills, 1000);
    if(!active && runTimerInterval){ clearInterval(runTimerInterval); runTimerInterval = null; }
}
function smartNodeViewHost(){
    return {
        measureSmartNodeImages:()=>measureSmartNodeImages(),
        handleSmartImageDropEvent:(...args)=>smartMediaInputController.dropOnNode(...args),
        get MEDIA_GROUP_MAX_VISIBLE_ROWS(){return MEDIA_GROUP_MAX_VISIBLE_ROWS;},
        get SMART_GROUP_DEFAULT_HEIGHT(){return SMART_GROUP_DEFAULT_HEIGHT;},
        get SMART_GROUP_DEFAULT_WIDTH(){return SMART_GROUP_DEFAULT_WIDTH;},
        get SMART_GROUP_MAX_VISIBLE_ROWS(){return SMART_GROUP_MAX_VISIBLE_ROWS;},
        get SMART_LOG_PREVIEW_NODE_ID(){return SMART_LOG_PREVIEW_NODE_ID;},
        get composer(){return composer;},
        get document(){return document;},
        get dragState(){return dragState;},
        set dragState(value){dragState=value;},
        get escapeAttr(){return escapeAttr;},
        get imageClickTimer(){return imageClickTimer;},
        set imageClickTimer(value){imageClickTimer=value;},
        get llmInstructionResizeState(){return llmInstructionResizeState;},
        set llmInstructionResizeState(value){llmInstructionResizeState=value;},
        get lucide(){return lucide;},
        get nodes(){return nodes;},
        get pendingGroupUploadPoint(){return pendingGroupUploadPoint;},
        set pendingGroupUploadPoint(value){pendingGroupUploadPoint=value;},
        get portDragState(){return portDragState;},
        set portDragState(value){portDragState=value;},
        get promptInput(){return promptInput;},
        get promptSplitResizeState(){return promptSplitResizeState;},
        set promptSplitResizeState(value){promptSplitResizeState=value;},
        get resizeState(){return resizeState;},
        set resizeState(value){resizeState=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get shell(){return shell;},
        get smartCascadeSilentSelection(){return smartCascadeSilentSelection;},
        set smartCascadeSilentSelection(value){smartCascadeSilentSelection=value;},
        get smartWorkflowTransferModal(){return smartWorkflowTransferModal;},
        get suppressImageClickUntil(){return suppressImageClickUntil;},
        set suppressImageClickUntil(value){suppressImageClickUntil=value;},
        get suppressNodeClickUntil(){return suppressNodeClickUntil;},
        get thumbDragState(){return thumbDragState;},
        set thumbDragState(value){thumbDragState=value;},
        get uploadTargetId(){return uploadTargetId;},
        set uploadTargetId(value){uploadTargetId=value;},
        get window(){return window;},
        get world(){return world;},
        get CanvasViewAdjust(){return CanvasViewAdjust;},
        activePromptTemplateNodeId:(...args)=>activePromptTemplateNodeId(...args),
        bindConnectionEvents:(...args)=>bindConnectionEvents(...args),
        bindNodeEvents:(...args)=>bindNodeEvents(...args),
        bindScrollableText:(...args)=>bindScrollableText(...args),
        bindSmartAudioMedia:(...args)=>bindSmartAudioMedia(...args),
        bindSmartPreviewImageFallbacks:(...args)=>bindSmartPreviewImageFallbacks(...args),
        cancelSmartDepthCapture:(...args)=>cancelSmartDepthCapture(...args),
        captureMediaPlaybackStates:(...args)=>captureMediaPlaybackStates(...args),
        capturePendingUndo:(...args)=>capturePendingUndo(...args),
        chatModelOptions:(...args)=>chatModelOptions(...args),
        chatProviderOptions:(...args)=>chatProviderOptions(...args),
        clearImageClickTimer:(...args)=>clearImageClickTimer(...args),
        deleteImage:(...args)=>deleteImage(...args),
        deleteNodeFromButton:(...args)=>deleteNodeFromButton(...args),
        disconnectConnections:(...args)=>disconnectConnections(...args),
        duplicateForAltDrag:(...args)=>duplicateForAltDrag(...args),
        editPromptPresetForNode:(...args)=>editPromptPresetForNode(...args),
        ensurePortDragPathElement:(...args)=>ensurePortDragPathElement(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fitSmartLoopNode:(...args)=>fitSmartLoopNode(...args),
        hideRunTimerForNode:(...args)=>hideRunTimerForNode(...args),
        imageForDisplay:(...args)=>imageForDisplay(...args),
        imageLayout:(...args)=>imageLayout(...args),
        imageNameBadgeHtml:(...args)=>imageNameBadgeHtml(...args),
        imageResolutionBadgeHtml:(...args)=>imageResolutionBadgeHtml(...args),
        insertSmartLoopToken:(...args)=>insertSmartLoopToken(...args),
        isHistoryGroupNode:(...args)=>isHistoryGroupNode(...args),
        isNodeSelected:(...args)=>isNodeSelected(...args),
        isSmartGroupCompactMember:(...args)=>isSmartGroupCompactMember(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        isSmartLoopDefaultPrompt:(...args)=>isSmartLoopDefaultPrompt(...args),
        jimengImageProviderId:(...args)=>jimengImageProviderId(...args),
        jimengQueueText:(...args)=>jimengQueueText(...args),
        loopNumberControlHtml:(...args)=>loopNumberControlHtml(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        nodeBodyHtml:(...args)=>nodeBodyHtml(...args),
        nodeRect:(...args)=>nodeRect(...args),
        nodeScale:(...args)=>nodeScale(...args),
        openCreateMenu:(...args)=>openCreateMenu(...args),
        openImagePreviewSmart:(...args)=>openImagePreviewSmart(...args),
        openSmartVideoEditor:(...args)=>openSmartVideoEditor(...args),
        openSmartViewAdjustment:(...args)=>openSmartViewAdjustment(...args),
        pickMediaForSmartNode:(...args)=>pickMediaForSmartNode(...args),
        promptLlmInstructionHeight:(...args)=>promptLlmInstructionHeight(...args),
        promptNodeExpandedHeight:(...args)=>promptNodeExpandedHeight(...args),
        promptNodeInputImages:(...args)=>promptNodeInputImages(...args),
        promptNodeLayoutSize:(...args)=>promptNodeLayoutSize(...args),
        promptNodeMinHeight:(...args)=>promptNodeMinHeight(...args),
        promptNodePromptItems:(...args)=>promptNodePromptItems(...args),
        promptNodeSeparator:(...args)=>promptNodeSeparator(...args),
        promptNodeSplitExtraHeight:(...args)=>promptNodeSplitExtraHeight(...args),
        promptNodeSplitPreviewHeight:(...args)=>promptNodeSplitPreviewHeight(...args),
        promptNodeUpstreamPromptItems:(...args)=>promptNodeUpstreamPromptItems(...args),
        queryJimengNow:(...args)=>queryJimengNow(...args),
        querySmartImageTaskNow:(...args)=>querySmartImageTaskNow(...args),
        refreshRunTimerPills:(...args)=>refreshRunTimerPills(...args),
        renameSmartNodeImage:(...args)=>renameSmartNodeImage(...args),
        render:(...args)=>render(...args),
        renderConnections:(...args)=>renderConnections(...args),
        renderMinimap:(...args)=>renderMinimap(...args),
        requestSmartCascadeStop:(...args)=>requestSmartCascadeStop(...args),
        resolveChatModel:(...args)=>resolveChatModel(...args),
        resolveChatProviderId:(...args)=>resolveChatProviderId(...args),
        restoreMediaPlaybackStates:(...args)=>restoreMediaPlaybackStates(...args),
        retrySmartDepthCapture:(...args)=>retrySmartDepthCapture(...args),
        runPromptLLMNode:(...args)=>runPromptLLMNode(...args),
        runSmartCascadeFromLoop:(...args)=>runSmartCascadeFromLoop(...args),
        runSmartGroupToolbarAction:(...args)=>runSmartGroupToolbarAction(...args),
        runSmartNodeToolbarAction:(...args)=>runSmartNodeToolbarAction(...args),
        runTimePillHtml:(...args)=>runTimePillHtml(...args),
        scheduleComposerUpdate:(...args)=>scheduleComposerUpdate(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        selectedNodeIds:(...args)=>selectedNodeIds(...args),
        setSmartDropCopyEffect:(...args)=>setSmartDropCopyEffect(...args),
        setSmartLoopPromptFieldValues:(...args)=>setSmartLoopPromptFieldValues(...args),
        setTimeout:(...args)=>setTimeout(...args),
        singleMediaHtml:(...args)=>singleMediaHtml(...args),
        smartActivateVideoPreview:(...args)=>smartActivateVideoPreview(...args),
        smartAudioBodyHtml:(...args)=>smartAudioBodyHtml(...args),
        smartCascadeAnyRunning:(...args)=>smartCascadeAnyRunning(...args),
        smartCascadeIsLoopRunning:(...args)=>smartCascadeIsLoopRunning(...args),
        smartCascadeRunForLoop:(...args)=>smartCascadeRunForLoop(...args),
        smartCascadeStopText:(...args)=>smartCascadeStopText(...args),
        smartGroupMembers:(...args)=>smartGroupMembers(...args),
        smartGroupThumbLayout:(...args)=>smartGroupThumbLayout(...args),
        smartGroupToolbarHtml:(...args)=>smartGroupToolbarHtml(...args),
        smartGroupZoom:(...args)=>smartGroupZoom(...args),
        smartLoopActivePromptFieldValues:(...args)=>smartLoopActivePromptFieldValues(...args),
        smartLoopCount:(...args)=>smartLoopCount(...args),
        smartLoopDefaultPromptText:(...args)=>smartLoopDefaultPromptText(...args),
        smartLoopEditorText:(...args)=>smartLoopEditorText(...args),
        smartLoopInputImages:(...args)=>smartLoopInputImages(...args),
        smartLoopInputPromptItems:(...args)=>smartLoopInputPromptItems(...args),
        smartLoopPreviewImages:(...args)=>smartLoopPreviewImages(...args),
        smartLoopPromptFieldValues:(...args)=>smartLoopPromptFieldValues(...args),
        smartLoopSelectedInputPrompt:(...args)=>smartLoopSelectedInputPrompt(...args),
        smartLoopVariableHtml:(...args)=>smartLoopVariableHtml(...args),
        smartNodeHasLiveMedia:(...args)=>smartNodeHasLiveMedia(...args),
        smartNodeInputThumbsHtml:(...args)=>smartNodeInputThumbsHtml(...args),
        smartNodeToolbarHtml:(...args)=>smartNodeToolbarHtml(...args),
        smartNodeToolbarImageIndex:(...args)=>smartNodeToolbarImageIndex(...args),
        smartPendingTasks:(...args)=>smartPendingTasks(...args),
        smartRecoverableImageTask:(...args)=>smartRecoverableImageTask(...args),
        syncPromptNodeHeightForSplit:(...args)=>syncPromptNodeHeightForSplit(...args),
        syncSelectionUi:(...args)=>syncSelectionUi(...args),
        syncSelectionGroup:(...args)=>syncSelectionGroup(...args),
        syncSmartSelectedImageResolution:(...args)=>syncSmartSelectedImageResolution(...args),
        thumbMediaHtml:(...args)=>thumbMediaHtml(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        transplantSmartMediaElements:(...args)=>transplantSmartMediaElements(...args),
        trf:(...args)=>trf(...args),
        updateComposer:(...args)=>updateComposer(...args),
        updateNodeElementDuringResize:(...args)=>updateNodeElementDuringResize(...args),
        updatePortDragVisual:(...args)=>updatePortDragVisual(...args),
        updateSmartWorkflowTransferMeta:(...args)=>updateSmartWorkflowTransferMeta(...args)
    };
}
function rememberInlineVideoActivations(){
    return SmartNodeView.rememberInlineVideoActivations(smartNodeViewHost());
}
function render(){
    return SmartNodeView.render(smartNodeViewHost());
}
function measureSmartNodeImages(){
    return smartImageDimensions.measure();
}
function bindConnectionEvents(){
    return SmartNodeBindings.bindConnectionEvents(smartNodeViewHost());
}
function ensurePortDragPathElement(){
    const svg = world.querySelector('svg.connection-layer');
    if(!svg) return null;
    let path = svg.querySelector('path.port-drag-temp');
    if(!path){
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'port-drag-temp conn-pending');
        path.setAttribute('stroke', 'rgba(100,116,139,0.92)');
        path.setAttribute('stroke-width', '1.9');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);
    }
    return path;
}
function clearPortDragVisual(){
    world.querySelector('path.port-drag-temp')?.remove();
    world.querySelectorAll('.node-port.is-active').forEach(el => el.classList.remove('is-active'));
    world.querySelectorAll('.image-node.port-hover').forEach(el => el.classList.remove('port-hover'));
}
function bindPromptNodeControls(el, node){
    return SmartNodeBindings.bindPromptNodeControls(smartNodeViewHost(), el, node);
}
function bindLoopNodeControls(el, node){
    return SmartNodeBindings.bindLoopNodeControls(smartNodeViewHost(), el, node);
}


function bindScrollableText(el){
    return smartTextSelection.bind(el);
}
function updatePortDragVisual(){
    if(!portDragState) return;
    const fromNode = nodes.find(n => n.id === portDragState.fromId);
    if(!fromNode) return;
    const fr = nodeRect(fromNode);
    const isOut = portDragState.fromPort === 'out';
    const fx = isOut ? fr.x + fr.width : fr.x;
    const fy = fr.y + fr.height / 2;
    const tx = portDragState.currentWorld.x;
    const ty = portDragState.currentWorld.y;
    const dx = Math.max(50, Math.abs(tx - fx) * 0.45);
    const sign = isOut ? 1 : -1;
    const path = ensurePortDragPathElement();
    if(path) path.setAttribute('d', `M${fx} ${fy} C ${fx + dx * sign} ${fy}, ${tx - dx * sign} ${ty}, ${tx} ${ty}`);
    world.querySelectorAll('.node-port.is-active').forEach(el => el.classList.remove('is-active'));
    world.querySelectorAll('.image-node.port-hover').forEach(el => el.classList.remove('port-hover'));
    if(portDragState.hoverTargetId){
        const targetNodeEl = world.querySelector(`.image-node[data-id="${portDragState.hoverTargetId}"]`);
        targetNodeEl?.classList.add('port-hover');
        targetNodeEl?.querySelector(`.node-port[data-port="${portDragState.hoverPort}"]`)?.classList.add('is-active');
    }
}
function handlePortDrop(drag, e){
    const {targetId, targetPort, hit} = (() => {
        const hitEl = document.elementFromPoint(e.clientX, e.clientY);
        const portEl = hitEl?.closest?.('.node-port');
        const nodeEl = portEl?.closest?.('.image-node') || hitEl?.closest?.('.image-node');
        let id = '', port = '';
        if(nodeEl && nodeEl.dataset.id && nodeEl.dataset.id !== drag.fromId){
            id = nodeEl.dataset.id;
            if(portEl){
                port = portEl.dataset.port;
            } else {
                const rect = nodeEl.getBoundingClientRect();
                port = (e.clientX - rect.left) < rect.width / 2 ? 'in' : 'out';
            }
        }
        return {targetId:id, targetPort:port, hit:hitEl};
    })();
    if(targetId){
        const compatible = (drag.fromPort === 'out' && targetPort === 'in') || (drag.fromPort === 'in' && targetPort === 'out');
        if(!compatible){ discardPendingUndo(); render(); return; }
        const fromId = drag.fromPort === 'out' ? drag.fromId : targetId;
        const toId = drag.fromPort === 'out' ? targetId : drag.fromId;
        if(connectInputNode(fromId, toId)){
            commitPendingUndo();
            render();
            scheduleSave();
        } else {
            discardPendingUndo();
            render();
        }
        return;
    }
    if(!drag.moved){ discardPendingUndo(); render(); return; }
    if(hit?.closest?.('.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.image-edit-modal,.smart-minimap')){
        discardPendingUndo(); render(); return;
    }
    const p = screenToWorld(e);
    undoSuppressed = true;
    const newNode = createImageNodeAt(p, [], {select:true, skipUndo:true});
    undoSuppressed = false;
    const fromId = drag.fromPort === 'out' ? drag.fromId : newNode.id;
    const toId = drag.fromPort === 'out' ? newNode.id : drag.fromId;
    connectInputNode(fromId, toId);
    commitPendingUndo();
    render();
    scheduleSave();
}
function pickMediaForSmartNode(nodeId){
    return smartMediaInputController.pick(nodeId);
}
function bindNodeEvents(){
    return SmartNodeBindings.bindNodeEvents(smartNodeViewHost());
}
function rectOverlapNode(draggedId, x, y, w, h, excludeIds=[]){
    const cx = x + w/2, cy = y + h/2;
    const excluded = new Set([draggedId, ...(excludeIds || [])]);
    for(const n of nodes){
        if(excluded.has(n.id)) continue;
        const r = nodeRect(n);
        if(cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) return n;
    }
    return null;
}
function dragConnectTargetFor(sourceNode, point=lastMouseWorld){
    if(!sourceNode || (dragState?.group || []).length > 1) return null;
    if(['smart-prompt', 'smart-loop'].includes(sourceNode.type) && point){
        return rectOverlapNode(sourceNode.id, point.x - 1, point.y - 1, 2, 2, dragState?.groupIds || []);
    }
    const r = nodeRect(sourceNode);
    return rectOverlapNode(sourceNode.id, r.x, r.y, r.width, r.height, dragState?.groupIds || []);
}
function canAutoConnectDraggedNode(sourceNode, targetNode){
    if(!sourceNode || !targetNode || sourceNode.id === targetNode.id) return false;
    if(isHistoryGroupNode(sourceNode) || isHistoryGroupNode(targetNode)) return false;
    if(isSmartGroupNode(targetNode)) return false;
    if(isSmartImageNode(sourceNode)) return isSmartImageNode(targetNode) || targetNode.type === 'smart-loop' || targetNode.type === 'smart-prompt';
    if(sourceNode.type === 'smart-prompt') return isSmartImageNode(targetNode) || targetNode.type === 'smart-loop';
    if(sourceNode.type === 'smart-loop') return isSmartImageNode(targetNode);
    if(sourceNode.type === 'smart-group') return isSmartImageNode(targetNode) || targetNode.type === 'smart-loop';
    return false;
}
function restoreDraggedNodePosition(){
    if(!dragState) return;
    (dragState.group || [{id:dragState.id, ox:dragState.ox, oy:dragState.oy}]).forEach(item => {
        const n = nodes.find(x => x.id === item.id);
        if(n){
            n.x = item.ox;
            n.y = item.oy;
        }
    });
}
function pruneSmartGroupMembershipsForNode(node){
    if(!node || !node.id) return false;
    // 节点拖出分组：从所有分组移除自己（保持当前尺寸，不自动放大）。
    // 分组合并已改为“释放被拖分组、只并入其成员”，所以这里只需处理单个节点的退组。
    let changed = false;
    nodes.forEach(group => {
        if(!isSmartGroupNode(group) || !Array.isArray(group.items) || !group.items.includes(node.id)) return;
        group.items = group.items.filter(id => id !== node.id);
        changed = true;
    });
    return changed;
}
function clearDropHighlight(){
    world.querySelectorAll('.image-node.drop-target').forEach(el => el.classList.remove('drop-target'));
}
function setDropHighlight(targetId){
    clearDropHighlight();
    if(!targetId) return;
    const el = world.querySelector(`.image-node[data-id="${targetId}"]`);
    if(el) el.classList.add('drop-target');
}
function deleteNode(id){
    return SmartNodeEdit.deleteNode(smartNodeEditHost(), id);
}
function clearNodeMediaBeforeDelete(id){
    return SmartNodeEdit.clearNodeMediaBeforeDelete(smartNodeEditHost(), id);
}
function deleteNodeFromButton(id){
    return SmartNodeEdit.deleteNodeFromButton(smartNodeEditHost(), id);
}
function disconnectConnection(index){
    return SmartConnectionEdit.disconnectConnection(smartNodeEditHost(), index);
}
// 断开一条或多条连线（合并到分组的连线会一次性断开其下所有成员连线）。spec 可为索引数组或逗号分隔字符串。
function disconnectConnections(spec){
    return SmartConnectionEdit.disconnectConnections(smartNodeEditHost(), spec);
}
function connectionIndexSpecFromPoint(clientX, clientY){
    const el = document.elementFromPoint(clientX, clientY);
    const connEl = el?.closest?.('[data-conn-index]');
    return connEl?.dataset?.connIndex || '';
}
function eraseConnectionsAtClientPoint(clientX, clientY){
    if(!connectionEraseState || !canvas || !Array.isArray(canvas.connections)) return false;
    const spec = connectionIndexSpecFromPoint(clientX, clientY);
    if(!spec) return false;
    const indices = String(spec).split(',')
        .map(v => Number(v))
        .filter(n => Number.isInteger(n) && n >= 0 && n < canvas.connections.length && !connectionEraseState.indices.has(n));
    if(!indices.length) return false;
    indices.forEach(index => connectionEraseState.indices.add(index));
    connectionEraseState.started = true;
    connectionEraseState.count = connectionEraseState.indices.size;
    world.querySelectorAll('[data-conn-index]').forEach(el => {
        const hasHit = String(el.dataset.connIndex || '').split(',').some(v => connectionEraseState.indices.has(Number(v)));
        if(hasHit) el.classList.add('conn-erasing-mark');
    });
    return true;
}
function finishConnectionErase(){
    if(!connectionEraseState || !canvas || !Array.isArray(canvas.connections)) return false;
    const set = new Set(connectionEraseState.indices || []);
    if(!set.size) return false;
    const removed = canvas.connections.filter((_, i) => set.has(i));
    if(!removed.length) return false;
    pushUndo();
    canvas.connections = canvas.connections.filter((_, i) => !set.has(i));
    removed.forEach(conn => {
        const toNode = nodes.find(n => n.id === conn.to);
        if(toNode && Array.isArray(toNode.inputNodeIds)){
            toNode.inputNodeIds = toNode.inputNodeIds.filter(id => id !== conn.from);
        }
        const stillConnected = (canvas.connections || []).some(item => item.from === conn.from && item.to === conn.to && ['input','flow'].includes(item.kind || 'flow'));

        if(toNode && ['input','flow'].includes(conn.kind || 'flow')) clearDetachedRunInputRefs(toNode);
        if((conn.kind || 'flow') === 'history'){
            const group = nodes.find(n => n.id === conn.to && isHistoryGroupNode(n) && n.historyFor === conn.from);
            demoteHistoryGroupNode(group);
        }
    });
    render();
    return true;
}
function eraseConnectionsAtPoint(event){
    return eraseConnectionsAtClientPoint(event.clientX, event.clientY);
}
function eraseConnectionsAlongPointer(event){
    if(!connectionEraseState) return false;
    const lastX = Number.isFinite(connectionEraseState.lastX) ? connectionEraseState.lastX : event.clientX;
    const lastY = Number.isFinite(connectionEraseState.lastY) ? connectionEraseState.lastY : event.clientY;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    const steps = Math.max(1, Math.min(12, Math.ceil(Math.hypot(dx, dy) / 8)));
    let changed = false;
    for(let i = 1; i <= steps; i++){
        const t = i / steps;
        changed = eraseConnectionsAtClientPoint(lastX + dx * t, lastY + dy * t) || changed;
    }
    connectionEraseState.lastX = event.clientX;
    connectionEraseState.lastY = event.clientY;
    return changed;
}
function ensureConnectionEraseTrail(){
    let svg = shell.querySelector(':scope > svg.connection-erase-trail');
    if(svg) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'connection-erase-trail');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path class="connection-erase-trail-glow" fill="none"></path><path class="connection-erase-trail-line" fill="none"></path>';
    shell.appendChild(svg);
    return svg;
}
function updateConnectionEraseTrail(event){
    if(!connectionEraseState) return;
    const p = shellPoint(event);
    connectionEraseState.trail = [...(connectionEraseState.trail || []), p].slice(-80);
    const points = connectionEraseState.trail;
    const svg = ensureConnectionEraseTrail();
    const rect = shell.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
    const d = points.map((pt, index) => `${index ? 'L' : 'M'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
    svg.querySelectorAll('path').forEach(path => path.setAttribute('d', d));
}
function clearConnectionEraseTrail(){
    const svg = shell.querySelector(':scope > svg.connection-erase-trail');
    if(!svg) return;
    svg.classList.add('fading');
    setTimeout(() => svg.remove(), 180);
}
function connectionMidpoint(conn){
    const fromNode = nodes.find(n => n.id === conn?.from);
    const toNode = nodes.find(n => n.id === conn?.to);
    if(!fromNode || !toNode) return null;
    const fr = nodeRect(fromNode), tr = nodeRect(toNode);
    if((conn.kind || 'flow') === 'history'){
        return {x:(fr.x + fr.width / 2 + tr.x + tr.width / 2) / 2, y:(fr.y + fr.height + tr.y) / 2};
    }
    return {x:(fr.x + fr.width + tr.x) / 2, y:(fr.y + fr.height / 2 + tr.y + tr.height / 2) / 2};
}
function insertionConnectionForNode(node){
    if(!node || node.type !== 'smart-loop' || !canvas?.connections?.length) return null;
    const r = nodeRect(node);
    const cx = (Number(r.x) || 0) + (Number(r.width) || 0) / 2;
    const cy = (Number(r.y) || 0) + (Number(r.height) || 0) / 2;
    let best = null;
    (canvas.connections || []).forEach((conn, index) => {
        const kind = conn.kind || 'flow';
        if(!['input','flow'].includes(kind)) return;
        if(conn.from === node.id || conn.to === node.id) return;
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);
        if(!fromNode || !toNode || isHistoryGroupNode(fromNode) || isHistoryGroupNode(toNode)) return;
        const mid = connectionMidpoint(conn);
        if(!mid) return;
        const score = Math.hypot(cx - mid.x, cy - mid.y);
        if(score > 96) return;
        if(!best || score < best.score) best = {conn, index, score};
    });
    return best;
}
function insertLoopNodeIntoConnection(loopNode, hit){
    if(!loopNode || loopNode.type !== 'smart-loop' || !hit?.conn) return false;
    const conn = hit.conn;
    const kind = conn.kind || 'flow';
    canvas.connections = (canvas.connections || []).filter((c, index) => index !== hit.index);
    nodes.forEach(n => {
        if(Array.isArray(n.inputNodeIds)) n.inputNodeIds = n.inputNodeIds.filter(id => !(n.id === conn.to && id === conn.from));
    });
    addConnection(conn.from, loopNode.id, kind === 'flow' ? 'flow' : 'input');
    connectInputNode(loopNode.id, conn.to);
    return true;
}
function updateLoopInsertPreview(){
    const node = dragState ? nodes.find(n => n.id === dragState.id) : null;
    const next = node?.type === 'smart-loop' && dragState.ctrlGroup && (dragState.group || []).length <= 1
        ? insertionConnectionForNode(node)
        : null;
    const nextPreview = next ? {index:next.index} : null;
    const changed = (loopInsertPreview?.index ?? -1) !== (nextPreview?.index ?? -1);
    loopInsertPreview = nextPreview;
    if(changed) scheduleConnectionLayerRefresh();
    return next;
}
function deleteImage(id, imageIndex){
    const node = nodes.find(n => n.id === id);
    if(!node || imageIndex < 0) return;
    pushUndo();
    node.images = (node.images || []).filter((_, index) => index !== imageIndex);
    if(node.images.length <= 1) node.title = 'Image';
    if(selectedImage.nodeId === id) selectedImage = {nodeId:id, index:Math.min(selectedImage.index, node.images.length - 1)};
    if(selectedImage.index < 0) selectedImage = {nodeId:'', index:-1};
    render();
    scheduleSave();
}
async function renameSmartNodeImage(nodeId, imageIndex){
    const node = nodes.find(n => n.id === nodeId);
    const index = Math.max(0, Number(imageIndex) || 0);
    const image = node?.images?.[index];
    if(!node || !image) return;
    const current = imageNameLabel(image);
    const name = await openAssetNameDialog({title:'重命名图片', value:current, placeholder:'图片名称', cancelValue:null});
    if(name === null) return;
    const next = String(name || '').trim();
    if(!next || next === current) return;
    pushUndo();
    image.name = next;
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:node.id, index};
    render();
    scheduleSave();
}
function currentEditImage(){
    return SmartImageEditor.currentEditImage(smartImageEditorHost());
}
function cropImageDisplaySize(){
    return SmartImageEditor.cropImageDisplaySize(smartImageEditorHost());
}
function smartImageEditorHost(){
    return {
        captureImageEditContext:options=>ImageEditorSession.capture(smartImageEditorHost(),options),
        captureCanvasContext:()=>{const canvasCurrent=smartMediaInputController.capture(),editorCurrent=smartImageEditorEvents.capture();return ()=>canvasCurrent()&&editorCurrent();},
        get editImageSource(){return currentEditImage().image?.url||'';},
        get editSourceKey(){return imageEditMode==='grid'&&gridOperationMode==='join'?JSON.stringify(currentGridJoinItems().map(entry=>entry.item?.url||'')):(currentEditImage().image?.url||'');},
        get FormData(){return FormData;},
        fetch:(...args)=>fetch(...args),
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
        get gridJoinDrag(){return gridJoinDrag;},
        set gridJoinDrag(value){gridJoinDrag=value;},
        get gridJoinGroupId(){return gridJoinGroupId;},
        set gridJoinGroupId(value){gridJoinGroupId=value;},
        get gridJoinImageCache(){return gridJoinImageCache;},
        set gridJoinImageCache(value){gridJoinImageCache=value;},
        get gridJoinLayout(){return gridJoinLayout;},
        set gridJoinLayout(value){gridJoinLayout=value;},
        get gridJoinUserMoved(){return gridJoinUserMoved;},
        set gridJoinUserMoved(value){gridJoinUserMoved=value;},
        get gridOperationMode(){return gridOperationMode;},
        set gridOperationMode(value){gridOperationMode=value;},
        get imageEditBaseH(){return imageEditBaseH;},
        set imageEditBaseH(value){imageEditBaseH=value;},
        get imageEditBaseW(){return imageEditBaseW;},
        set imageEditBaseW(value){imageEditBaseW=value;},
        get imageEditModal(){return imageEditModal;},
        get imageEditMode(){return imageEditMode;},
        set imageEditMode(value){imageEditMode=value;},
        get imageEditModeTouched(){return imageEditModeTouched;},
        set imageEditModeTouched(value){imageEditModeTouched=value;},
        get imageEditPanDrag(){return imageEditPanDrag;},
        set imageEditPanDrag(value){imageEditPanDrag=value;},
        get imageEditZoom(){return imageEditZoom;},
        set imageEditZoom(value){imageEditZoom=value;},
        get imageResizeScale(){return imageResizeScale;},
        set imageResizeScale(value){imageResizeScale=value;},
        get nodes(){return nodes;},
        get panoramaState(){return panoramaState;},
        get previewCompareDrag(){return previewCompareDrag;},
        set previewCompareDrag(value){previewCompareDrag=value;},
        get previewCompareIndex(){return previewCompareIndex;},
        set previewCompareIndex(value){previewCompareIndex=value;},
        get previewCompareOn(){return previewCompareOn;},
        set previewCompareOn(value){previewCompareOn=value;},
        get previewNavState(){return previewNavState;},
        set previewNavState(value){previewNavState=value;},
        get previewPanDrag(){return previewPanDrag;},
        set previewPanDrag(value){previewPanDrag=value;},
        get promptInput(){return promptInput;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get settings(){return settings;},
        set settings(value){settings=value;},
        get window(){return window;},
        activeSettingsSubject:(...args)=>activeSettingsSubject(...args),
        applyImageBrush:(...args)=>applyImageBrush(...args),
        applyImageGridSplit:(...args)=>applyImageGridSplit(...args),
        applyImageMask:(...args)=>applyImageMask(...args),
        canGridJoinCurrentNode:(...args)=>canGridJoinCurrentNode(...args),
        cleanupSmartLogPreviewNode:(...args)=>cleanupSmartLogPreviewNode(...args),
        clearEditDrawing:(...args)=>clearEditDrawing(...args),
        cloneSmartSettings:(...args)=>cloneSmartSettings(...args),
        displayMediaUrl:(...args)=>displayMediaUrl(...args),
        disposePanoramaPreview:(...args)=>disposePanoramaPreview(...args),
        downloadNameForMediaItem:(...args)=>downloadNameForMediaItem(...args),
        downloadPreviewFile:(...args)=>downloadPreviewFile(...args),
        editDrawCanvas:(...args)=>editDrawCanvas(...args),
        editTextCanvas:(...args)=>editTextCanvas(...args),
        exceedsFourKStandard:(...args)=>exceedsFourKStandard(...args),
        imageForDisplay:(...args)=>imageForDisplay(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        previewDownloadGroupItems:(...args)=>previewDownloadGroupItems(...args),
        proxiedMediaUrl:(...args)=>proxiedMediaUrl(...args),
        refreshComparePanel:(...args)=>refreshComparePanel(...args),
        refreshGridSplitPreview:(...args)=>refreshGridSplitPreview(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        removeEditTextInlineEditor:(...args)=>removeEditTextInlineEditor(...args),
        render:(...args)=>render(...args),
        renderDynamicParams:(...args)=>renderDynamicParams(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        resetEditDrawingHistory:(...args)=>resetEditDrawingHistory(...args),
        resetPanoramaView:(...args)=>resetPanoramaView(...args),
        resetPreviewTransform:(...args)=>resetPreviewTransform(...args),
        resizeEditDrawCanvas:(...args)=>resizeEditDrawCanvas(...args),
        safeExportFileName:(...args)=>safeExportFileName(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setPromptDraftForNode:(...args)=>setPromptDraftForNode(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartMediaPreviewUrl:(...args)=>smartMediaPreviewUrl(...args),
        smartSettingsForNode:(...args)=>smartSettingsForNode(...args),
        syncBrushToolButtons:(...args)=>syncBrushToolButtons(...args),
        syncEditDrawingHistoryButtons:(...args)=>syncEditDrawingHistoryButtons(...args),
        syncGridCustomControls:(...args)=>syncGridCustomControls(...args),
        syncGridCustomCursor:(...args)=>syncGridCustomCursor(...args),
        syncGridCustomUndoBtn:(...args)=>syncGridCustomUndoBtn(...args),
        syncGridGapValue:(...args)=>syncGridGapValue(...args),
        syncGridOperationControls:(...args)=>syncGridOperationControls(...args),
        syncTextToolState:(...args)=>syncTextToolState(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        updatePreviewMetaHint:(...args)=>updatePreviewMetaHint(...args),
        updatePreviewNavButtons:(...args)=>updatePreviewNavButtons(...args),
        updateZoomLabel:(...args)=>updateZoomLabel(...args),
        uploadCroppedBlob:(...args)=>uploadCroppedBlob(...args),
        withOutpaintDisplaySettings:(...args)=>withOutpaintDisplaySettings(...args)
    };
}
function cropBounds(){
    return SmartImageEditor.cropBounds(smartImageEditorHost());
}
function editDrawCanvas(){
    return SmartEditorDraw.editDrawCanvas(smartEditorDrawHost());
}
function smartEditorDrawHost(){
    return {
        captureImageEditContext:options=>ImageEditorSession.capture(smartImageEditorHost(),options),
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
        get gridOperationMode(){return gridOperationMode;},
        get imageEditMode(){return imageEditMode;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get window(){return window;},
        brushColor:(...args)=>brushColor(...args),
        closeImageEditor:(...args)=>closeImageEditor(...args),
        cropImageDisplaySize:(...args)=>cropImageDisplaySize(...args),
        currentEditImage:(...args)=>currentEditImage(...args),
        editBrushSize:(...args)=>editBrushSize(...args),
        editDrawPoint:(...args)=>editDrawPoint(...args),
        editTextCanvas:(...args)=>editTextCanvas(...args),
        editTextHasContent:(...args)=>editTextHasContent(...args),
        gridCustomLineHit:(...args)=>gridCustomLineHit(...args),
        pushEditDrawHistory:(...args)=>pushEditDrawHistory(...args),
        refreshGridSplitPreview:(...args)=>refreshGridSplitPreview(...args),
        removeEditTextInlineEditor:(...args)=>removeEditTextInlineEditor(...args),
        render:(...args)=>render(...args),
        renderEditTextCanvas:(...args)=>renderEditTextCanvas(...args),
        replaceEditedImage:(...args)=>replaceEditedImage(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        resizeEditTextCanvas:(...args)=>resizeEditTextCanvas(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setGridCustomLinePos:(...args)=>setGridCustomLinePos(...args),
        syncGridCustomUndoBtn:(...args)=>syncGridCustomUndoBtn(...args),
        syncTextToolState:(...args)=>syncTextToolState(...args),
        uid:(...args)=>uid(...args),
        uploadCroppedBlob:(...args)=>uploadCroppedBlob(...args)
    };
}
function editTextCanvas(){
    return SmartEditorText.editTextCanvas(smartEditorDrawHost());
}
function editTextContext(){
    return SmartEditorText.editTextContext(smartEditorDrawHost());
}
function selectedEditTextItem(){
    return SmartEditorText.selectedEditTextItem(smartEditorDrawHost());
}
function defaultEditTextText(){
    return SmartEditorText.defaultEditTextText(smartEditorDrawHost());
}
function editTextSizeFromBrush(){
    return SmartEditorText.editTextSizeFromBrush(smartEditorDrawHost());
}
function createEditTextItem(text, point, preset={}){
    return SmartEditorText.createEditTextItem(smartEditorDrawHost(), text, point, preset);
}
function textItemFont(item){
    return SmartEditorText.textItemFont(smartEditorDrawHost(), item);
}
function measureEditTextItem(item, ctx=editTextContext()){
    return SmartEditorText.measureEditTextItem(smartEditorDrawHost(), item, ctx);
}
function hitEditTextItem(point){
    return SmartEditorText.hitEditTextItem(smartEditorDrawHost(), point);
}
function renderEditTextCanvas(){
    return SmartEditorText.renderEditTextCanvas(smartEditorDrawHost());
}
function syncTextToolState(force=false){
    return SmartEditorText.syncTextToolState(smartEditorDrawHost(), force);
}
function syncSelectedEditTextStyleFromBrush(){
    return SmartEditorText.syncSelectedEditTextStyleFromBrush(smartEditorDrawHost());
}
function beginTextEditChange(){
    return SmartEditorText.beginTextEditChange(smartEditorDrawHost());
}
function setSelectedEditTextItem(id){
    return SmartEditorText.setSelectedEditTextItem(smartEditorDrawHost(), id);
}
function confirmSelectedEditTextItem(){
    return SmartEditorText.confirmSelectedEditTextItem(smartEditorDrawHost());
}
function editTextCanvasScale(){
    return SmartEditorText.editTextCanvasScale(smartEditorDrawHost());
}
function selectInlineEditorText(el){
    return SmartEditorText.selectInlineEditorText(smartEditorDrawHost(), el);
}
function inlineEditorText(){
    return SmartEditorText.inlineEditorText(smartEditorDrawHost());
}
function autosizeEditTextInlineEditor(){
    return SmartEditorText.autosizeEditTextInlineEditor(smartEditorDrawHost());
}
function positionEditTextInlineEditor(){
    return SmartEditorText.positionEditTextInlineEditor(smartEditorDrawHost());
}
function removeEditTextInlineEditor(commit=true){
    return SmartEditorText.removeEditTextInlineEditor(smartEditorDrawHost(), commit);
}
function beginEditTextInline(item){
    return SmartEditorText.beginEditTextInline(smartEditorDrawHost(), item);
}
function editTextPoint(event){
    return SmartEditorText.editTextPoint(smartEditorDrawHost(), event);
}
function beginEditText(event){
    return SmartEditorText.beginEditText(smartEditorDrawHost(), event);
}
function updateEditTextCursor(event){
    return SmartEditorText.updateEditTextCursor(smartEditorDrawHost(), event);
}
function moveEditText(event){
    return SmartEditorText.moveEditText(smartEditorDrawHost(), event);
}
function endEditText(event){
    return SmartEditorText.endEditText(smartEditorDrawHost(), event);
}
function editTextHasContent(){
    return SmartEditorText.editTextHasContent(smartEditorDrawHost());
}
function resizeEditTextCanvas(){
    return SmartEditorText.resizeEditTextCanvas(smartEditorDrawHost());
}
function resizeEditDrawCanvas(){
    return SmartEditorDraw.resizeEditDrawCanvas(smartEditorDrawHost());
}
function setImageEditMode(mode, userTouched=false){
    return SmartImageEditor.setImageEditMode(smartImageEditorHost(), mode, userTouched);
}
let previewCompareOn = false;
let previewCompareIndex = -1;
let previewMetaExtraText = '';
function applyPreviewTransform(){
    return SmartMediaPreview.applyPreviewTransform(smartMediaPreviewHost());
}
function resetPreviewTransform(){
    return SmartMediaPreview.resetPreviewTransform(smartMediaPreviewHost());
}
function smartMediaPreviewHost(){
    return {
        get File(){return File;},
        get Image(){return Image;},
        get PANORAMA_RATIO_PRESETS(){return PANORAMA_RATIO_PRESETS;},
        get console(){return console;},
        get document(){return document;},
        get imageEditModal(){return imageEditModal;},
        get imageEditMode(){return imageEditMode;},
        get nodes(){return nodes;},
        get panoramaState(){return panoramaState;},
        get previewCompareIndex(){return previewCompareIndex;},
        set previewCompareIndex(value){previewCompareIndex=value;},
        get previewCompareOn(){return previewCompareOn;},
        set previewCompareOn(value){previewCompareOn=value;},
        get previewComparePos(){return previewComparePos;},
        set previewComparePos(value){previewComparePos=value;},
        get previewMetaExtraText(){return previewMetaExtraText;},
        set previewMetaExtraText(value){previewMetaExtraText=value;},
        get previewNavState(){return previewNavState;},
        get previewPan(){return previewPan;},
        set previewPan(value){previewPan=value;},
        get previewZoom(){return previewZoom;},
        set previewZoom(value){previewZoom=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get window(){return window;},
        applyPreviewTransform:(...args)=>applyPreviewTransform(...args),
        bindSmartPreviewImageFallbacks:(...args)=>bindSmartPreviewImageFallbacks(...args),
        cancelAnimationFrame:(...args)=>cancelAnimationFrame(...args),
        clearTimeout:(...args)=>clearTimeout(...args),
        createImageNodeAt:(...args)=>createImageNodeAt(...args),
        currentEditImage:(...args)=>currentEditImage(...args),
        displayMediaUrl:(...args)=>displayMediaUrl(...args),
        disposePanoramaPreview:(...args)=>disposePanoramaPreview(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fileNameFromUrl:(...args)=>fileNameFromUrl(...args),
        inputImagesFor:(...args)=>inputImagesFor(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        nodeRect:(...args)=>nodeRect(...args),
        openImageEditor:(...args)=>openImageEditor(...args),
        proxiedMediaUrl:(...args)=>proxiedMediaUrl(...args),
        pushUndo:(...args)=>pushUndo(...args),
        refreshComparePanel:(...args)=>refreshComparePanel(...args),
        render:(...args)=>render(...args),
        requestAnimationFrame:(...args)=>requestAnimationFrame(...args),
        resizePanoramaViewer:(...args)=>resizePanoramaViewer(...args),
        safeExportFileName:(...args)=>safeExportFileName(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setImageEditMode:(...args)=>setImageEditMode(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartGroupContainingNode:(...args)=>smartGroupContainingNode(...args),
        smartGroupImageRefs:(...args)=>smartGroupImageRefs(...args),
        smartMediaPreviewUrl:(...args)=>smartMediaPreviewUrl(...args),
        smartPreviewImgHtml:(...args)=>smartPreviewImgHtml(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        updatePreviewMetaHint:(...args)=>updatePreviewMetaHint(...args),
        updateZoomLabel:(...args)=>updateZoomLabel(...args),
        uploadFiles:(...args)=>uploadFiles(...args),
        viewportCenter:(...args)=>viewportCenter(...args)
    };
}
function panoramaRatioValue(){
    return SmartPanorama.panoramaRatioValue(smartMediaPreviewHost());
}
function panoramaResolutionValue(){
    return SmartPanorama.panoramaResolutionValue(smartMediaPreviewHost());
}
function panoramaSource(){
    return SmartPanorama.panoramaSource(smartMediaPreviewHost());
}
function panoramaFallbackSource(){
    return SmartPanorama.panoramaFallbackSource(smartMediaPreviewHost());
}
function isLikelyPanoramaImage(node, image, naturalW=0, naturalH=0){
    return SmartPanorama.isLikelyPanoramaImage(smartMediaPreviewHost(), node, image, naturalW, naturalH);
}
async function ensurePanoramaRenderer(){
    return SmartPanorama.ensurePanoramaRenderer(smartMediaPreviewHost());
}
function applyPanoramaTexture(img){
    return SmartPanorama.applyPanoramaTexture(smartMediaPreviewHost(), img);
}
function drawPanoramaFrame(){
    return SmartPanorama.drawPanoramaFrame(smartMediaPreviewHost());
}
function renderPanoramaFrame(){
    return SmartPanorama.renderPanoramaFrame(smartMediaPreviewHost());
}
function startPanoramaLoop(){
    return SmartPanorama.startPanoramaLoop(smartMediaPreviewHost());
}
function stopPanoramaLoop(){
    return SmartPanorama.stopPanoramaLoop(smartMediaPreviewHost());
}
function resizePanoramaViewer(){
    return SmartPanorama.resizePanoramaViewer(smartMediaPreviewHost());
}
function disposePanoramaTexture(){
    return SmartPanorama.disposePanoramaTexture(smartMediaPreviewHost());
}
async function loadPanoramaTexture(src, allowFallback=true){
    return SmartPanorama.loadPanoramaTexture(smartMediaPreviewHost(), src, allowFallback);
}
function refreshPanoramaControls(){
    return SmartPanorama.refreshPanoramaControls(smartMediaPreviewHost());
}
function setPanoramaEnabled(enabled){
    return SmartPanorama.setPanoramaEnabled(smartMediaPreviewHost(), enabled);
}
function togglePanoramaPreview(){
    return SmartPanorama.togglePanoramaPreview(smartMediaPreviewHost());
}
async function exportPanoramaFrame(){
    return SmartPanorama.exportPanoramaFrame(smartMediaPreviewHost());
}
function resetPanoramaView(){
    return SmartPanorama.resetPanoramaView(smartMediaPreviewHost());
}
function disposePanoramaPreview(){
    return SmartPanorama.disposePanoramaPreview(smartMediaPreviewHost());
}
function applyPanoramaRatio(value){
    return SmartPanorama.applyPanoramaRatio(smartMediaPreviewHost(), value);
}
function setPreviewComparePos(clientX){
    return SmartMediaPreview.setPreviewComparePos(smartMediaPreviewHost(), clientX);
}
function syncPreviewFrameSize(){
    return SmartMediaPreview.syncPreviewFrameSize(smartMediaPreviewHost());
}
function previewResolutionText(){
    return SmartMediaPreview.previewResolutionText(smartMediaPreviewHost());
}
function updatePreviewMetaHint(extraText=previewMetaExtraText){
    return SmartMediaPreview.updatePreviewMetaHint(smartMediaPreviewHost(), extraText);
}
function rememberPreviewImageResolution(){
    return SmartMediaPreview.rememberPreviewImageResolution(smartMediaPreviewHost());
}
function previewCompareSources(){
    return SmartMediaPreview.previewCompareSources(smartMediaPreviewHost());
}
function refreshComparePanel(){
    return SmartMediaPreview.refreshComparePanel(smartMediaPreviewHost());
}
function togglePreviewCompare(){
    return SmartMediaPreview.togglePreviewCompare(smartMediaPreviewHost());
}
function currentPreviewVideo(){
    return SmartMediaPreview.currentPreviewVideo(smartMediaPreviewHost());
}
function videoFrameStep(){
    return SmartMediaPreview.videoFrameStep(smartMediaPreviewHost());
}
function seekPreviewVideoFrames(direction){
    return SmartMediaPreview.seekPreviewVideoFrames(smartMediaPreviewHost(), direction);
}
function waitForVideoEvent(video, eventName, timeout=1500){
    return SmartMediaPreview.waitForVideoEvent(smartMediaPreviewHost(), video, eventName, timeout);
}
async function seekVideoForFrame(video, time){
    return SmartMediaPreview.seekVideoForFrame(smartMediaPreviewHost(), video, time);
}
async function exportVideoFrame(which='current'){
    return SmartMediaPreview.exportVideoFrame(smartMediaPreviewHost(), which);
}
function editDrawSnapshot(){
    return SmartEditorDraw.editDrawSnapshot(smartEditorDrawHost());
}
function restoreEditDrawSnapshot(snapshot){
    return SmartEditorDraw.restoreEditDrawSnapshot(smartEditorDrawHost(), snapshot);
}
function pushEditDrawHistory(){
    return SmartEditorDraw.pushEditDrawHistory(smartEditorDrawHost());
}
function syncEditDrawingHistoryButtons(){
    return SmartEditorDraw.syncEditDrawingHistoryButtons(smartEditorDrawHost());
}
function undoEditDrawing(){
    return SmartEditorDraw.undoEditDrawing(smartEditorDrawHost());
}
function redoEditDrawing(){
    return SmartEditorDraw.redoEditDrawing(smartEditorDrawHost());
}
function editCanvasHasPixels(){
    return SmartEditorDraw.editCanvasHasPixels(smartEditorDrawHost());
}
function clearEditDrawing(silent=false){
    return SmartEditorDraw.clearEditDrawing(smartEditorDrawHost(), silent);
}
function resetEditDrawingHistory(){
    return SmartEditorDraw.resetEditDrawingHistory(smartEditorDrawHost());
}
function setBrushTool(tool){
    return SmartEditorDraw.setBrushTool(smartEditorDrawHost(), tool);
}
function syncBrushToolButtons(){
    return SmartEditorDraw.syncBrushToolButtons(smartEditorDrawHost());
}
function editDrawPoint(event){
    return SmartEditorDraw.editDrawPoint(smartEditorDrawHost(), event);
}
function smartEditorGridHost(){
    return {
        captureImageEditContext:options=>ImageEditorSession.capture(smartImageEditorHost(),options),
        get CSS(){return CSS;},
        get Image(){return Image;},
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
        get gridJoinDrag(){return gridJoinDrag;},
        set gridJoinDrag(value){gridJoinDrag=value;},
        get gridJoinGroupId(){return gridJoinGroupId;},
        set gridJoinGroupId(value){gridJoinGroupId=value;},
        get gridJoinImageCache(){return gridJoinImageCache;},
        get gridJoinLayout(){return gridJoinLayout;},
        set gridJoinLayout(value){gridJoinLayout=value;},
        get gridJoinOutputSize(){return gridJoinOutputSize;},
        set gridJoinOutputSize(value){gridJoinOutputSize=value;},
        get gridJoinUserMoved(){return gridJoinUserMoved;},
        set gridJoinUserMoved(value){gridJoinUserMoved=value;},
        get gridOperationMode(){return gridOperationMode;},
        set gridOperationMode(value){gridOperationMode=value;},
        get imageEditModal(){return imageEditModal;},
        get imageEditMode(){return imageEditMode;},
        get imageEditZoom(){return imageEditZoom;},
        get nodes(){return nodes;},
        closeImageEditor:(...args)=>closeImageEditor(...args),
        createImageNodeAt:(...args)=>createImageNodeAt(...args),
        createNode:(...args)=>createNode(...args),
        currentEditImage:(...args)=>currentEditImage(...args),
        displayMediaUrl:(...args)=>displayMediaUrl(...args),
        downloadNameForMediaItem:(...args)=>downloadNameForMediaItem(...args),
        editDrawCanvas:(...args)=>editDrawCanvas(...args),
        imageForDisplay:(...args)=>imageForDisplay(...args),
        imageLayout:(...args)=>imageLayout(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        nodeRect:(...args)=>nodeRect(...args),
        nodeScale:(...args)=>nodeScale(...args),
        openImageEditor:(...args)=>openImageEditor(...args),
        proxiedMediaUrl:(...args)=>proxiedMediaUrl(...args),
        render:(...args)=>render(...args),
        safeExportFileName:(...args)=>safeExportFileName(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setImageEditMode:(...args)=>setImageEditMode(...args),
        smartGroupImageRefs:(...args)=>smartGroupImageRefs(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args),
        uploadCroppedBlob:(...args)=>uploadCroppedBlob(...args),
        uploadImageBlobs:(...args)=>uploadImageBlobs(...args)
    };
}
function gridCustomLineHit(point){
    return SmartEditorGrid.gridCustomLineHit(smartEditorGridHost(), point);
}
function setGridCustomLinePos(index, point){
    return SmartEditorGrid.setGridCustomLinePos(smartEditorGridHost(), index, point);
}
const MASK_BRUSH_ALPHA = 115;
const MASK_BRUSH_COLOR = `rgba(255,255,255,${MASK_BRUSH_ALPHA / 255})`;
function editBrushSize(){
    return SmartEditorDraw.editBrushSize(smartEditorDrawHost());
}
function brushColor(){
    return SmartEditorDraw.brushColor(smartEditorDrawHost());
}
function setupDrawStyle(ctx){
    return SmartEditorDraw.setupDrawStyle(smartEditorDrawHost(), ctx);
}
function normalizeMaskPreviewCanvas(canvasEl=editDrawCanvas()){
    return SmartEditorDraw.normalizeMaskPreviewCanvas(smartEditorDrawHost(), canvasEl);
}
function strokeFreeDrawPoint(point){
    return SmartEditorDraw.strokeFreeDrawPoint(smartEditorDrawHost(), point);
}
function circledNumber(n){
    return SmartEditorDraw.circledNumber(smartEditorDrawHost(), n);
}
function drawBrushShape(ctx, start, end){
    return SmartEditorDraw.drawBrushShape(smartEditorDrawHost(), ctx, start, end);
}
function drawNumberLabel(point){
    return SmartEditorDraw.drawNumberLabel(smartEditorDrawHost(), point);
}
function beginEditDraw(event){
    return SmartEditorDraw.beginEditDraw(smartEditorDrawHost(), event);
}
function moveEditDraw(event){
    return SmartEditorDraw.moveEditDraw(smartEditorDrawHost(), event);
}
function endEditDraw(event){
    return SmartEditorDraw.endEditDraw(smartEditorDrawHost(), event);
}
function beginGridJoinDrag(event){
    return SmartEditorGrid.beginGridJoinDrag(smartEditorGridHost(), event);
}
function moveGridJoinDrag(event){
    return SmartEditorGrid.moveGridJoinDrag(smartEditorGridHost(), event);
}
function gridJoinDragTarget(){
    return SmartEditorGrid.gridJoinDragTarget(smartEditorGridHost());
}
function endGridJoinDrag(event){
    return SmartEditorGrid.endGridJoinDrag(smartEditorGridHost(), event);
}
function syncGridGapValue(){
    return SmartEditorGrid.syncGridGapValue(smartEditorGridHost());
}
function gridGapInputValue(){
    return SmartEditorGrid.gridGapInputValue(smartEditorGridHost());
}
function gridSplitSettings(){
    return SmartEditorGrid.gridSplitSettings(smartEditorGridHost());
}
function currentGridJoinItems(){
    return SmartEditorGrid.currentGridJoinItems(smartEditorGridHost());
}
// 从分组小菜单打开“宫格拼接”：锚定在分组第一张图片（保证编辑器有真实底图，不出现破图/尺寸异常），
// 但把拼接数据源切换到整个分组（gridJoinGroupId）。
function openGroupGridJoin(group){
    return SmartEditorGrid.openGroupGridJoin(smartEditorGridHost(), group);
}
function canGridJoinCurrentNode(){
    return SmartEditorGrid.canGridJoinCurrentNode(smartEditorGridHost());
}
function gridJoinAutoDims(count){
    return SmartEditorGrid.gridJoinAutoDims(smartEditorGridHost(), count);
}
function gridJoinNaturalSize(entry){
    return SmartEditorGrid.gridJoinNaturalSize(smartEditorGridHost(), entry);
}
function gridJoinBaseCellSize(items){
    return SmartEditorGrid.gridJoinBaseCellSize(smartEditorGridHost(), items);
}
function gridJoinItemDisplaySize(entry, cell){
    return SmartEditorGrid.gridJoinItemDisplaySize(smartEditorGridHost(), entry, cell);
}
function ensureGridJoinLayout(rows=null, cols=null){
    return SmartEditorGrid.ensureGridJoinLayout(smartEditorGridHost(), rows, cols);
}
function gridJoinVisualOrder(layout=gridJoinLayout){
    return SmartEditorGrid.gridJoinVisualOrder(smartEditorGridHost(), layout);
}
function setGridJoinLayoutOrder(order, rows=null, cols=null, gapOverride=null){
    return SmartEditorGrid.setGridJoinLayoutOrder(smartEditorGridHost(), order, rows, cols, gapOverride);
}
function resetGridJoinLayout(){
    return SmartEditorGrid.resetGridJoinLayout(smartEditorGridHost());
}
function applyGridJoinPreset(rows, cols){
    return SmartEditorGrid.applyGridJoinPreset(smartEditorGridHost(), rows, cols);
}
function setGridJoinOutputSize(size){
    return SmartEditorGrid.setGridJoinOutputSize(smartEditorGridHost(), size);
}
function syncGridJoinSizeControls(){
    return SmartEditorGrid.syncGridJoinSizeControls(smartEditorGridHost());
}
function setGridOperationMode(mode){
    return SmartEditorGrid.setGridOperationMode(smartEditorGridHost(), mode);
}
function syncGridOperationControls(){
    return SmartEditorGrid.syncGridOperationControls(smartEditorGridHost());
}
function gridSplitRects(width, height){
    return SmartEditorGrid.gridSplitRects(smartEditorGridHost(), width, height);
}
function gridSplitRectsCustom(width, height){
    return SmartEditorGrid.gridSplitRectsCustom(smartEditorGridHost(), width, height);
}
function gridLayoutFromRects(rects){
    return SmartEditorGrid.gridLayoutFromRects(smartEditorGridHost(), rects);
}
function applyGridPreset(rows, cols){
    return SmartEditorGrid.applyGridPreset(smartEditorGridHost(), rows, cols);
}
function syncGridCustomControls(){
    return SmartEditorGrid.syncGridCustomControls(smartEditorGridHost());
}
function toggleGridCustomMode(){
    return SmartEditorGrid.toggleGridCustomMode(smartEditorGridHost());
}
function setGridCustomOrientation(orient){
    return SmartEditorGrid.setGridCustomOrientation(smartEditorGridHost(), orient);
}
function clearGridCustomLines(){
    return SmartEditorGrid.clearGridCustomLines(smartEditorGridHost());
}
function undoGridCustomLine(){
    return SmartEditorGrid.undoGridCustomLine(smartEditorGridHost());
}
function syncGridCustomUndoBtn(){
    return SmartEditorGrid.syncGridCustomUndoBtn(smartEditorGridHost());
}
function clampImageResizeScale(value){
    return SmartImageEditor.clampImageResizeScale(smartImageEditorHost(), value);
}
function imageResizeDimensions(){
    return SmartImageEditor.imageResizeDimensions(smartImageEditorHost());
}
function syncImageResizeControls(){
    return SmartImageEditor.syncImageResizeControls(smartImageEditorHost());
}
function setImageResizeScale(value){
    return SmartImageEditor.setImageResizeScale(smartImageEditorHost(), value);
}
async function resizedImageBlobFromEditor(){
    return SmartImageEditor.resizedImageBlobFromEditor(smartImageEditorHost());
}
function applyImageEditZoom(scaleOverride=null){
    return SmartImageEditor.applyImageEditZoom(smartImageEditorHost(), scaleOverride);
}
function ensureImageEditBaseSize(force=false){
    return SmartImageEditor.ensureImageEditBaseSize(smartImageEditorHost(), force);
}
function syncImageEditOverflow(){
    return SmartImageEditor.syncImageEditOverflow(smartImageEditorHost());
}
function resetImageEditZoom(){
    return SmartImageEditor.resetImageEditZoom(smartImageEditorHost());
}
function updateZoomLabel(){
    const el = document.getElementById('imageEditZoomLabel');
    if(!el) return;
    if(imageEditMode === 'preview' && panoramaState.enabled){
        el.textContent = Math.round((75 / Math.max(1, panoramaState.fov)) * 100) + '%';
        return;
    }
    el.textContent = Math.round((imageEditMode === 'preview' ? previewZoom : imageEditZoom) * 100) + '%';
}
function syncGridCustomCursor(){
    return SmartEditorGrid.syncGridCustomCursor(smartEditorGridHost());
}
function gridJoinCanvasSize(layout=gridJoinLayout){
    return SmartEditorGrid.gridJoinCanvasSize(smartEditorGridHost(), layout);
}
function renderGridJoinPreview(){
    return SmartEditorGrid.renderGridJoinPreview(smartEditorGridHost());
}
function refreshGridSplitPreview(){
    return SmartEditorGrid.refreshGridSplitPreview(smartEditorGridHost());
}
function renderCropBox(){
    return SmartImageEditor.renderCropBox(smartImageEditorHost());
}
function outpaintNaturalSize(){
    return SmartImageEditor.outpaintNaturalSize(smartImageEditorHost());
}
function updateOutpaintResolutionLabel(){
    return SmartImageEditor.updateOutpaintResolutionLabel(smartImageEditorHost());
}
function clampOutpaint(){
    return SmartImageEditor.clampOutpaint(smartImageEditorHost());
}
function resetOutpaintBox(){
    return SmartImageEditor.resetOutpaintBox(smartImageEditorHost());
}
function cropRatioFromPreset(preset){
    return SmartImageEditor.cropRatioFromPreset(smartImageEditorHost(), preset);
}
function syncCropRatioButtons(){
    return SmartImageEditor.syncCropRatioButtons(smartImageEditorHost());
}
function fitCropRectToAspect(ratio, sourceRect=null){
    return SmartImageEditor.fitCropRectToAspect(smartImageEditorHost(), ratio, sourceRect);
}
function setCropAspectPreset(preset='free'){
    return SmartImageEditor.setCropAspectPreset(smartImageEditorHost(), preset);
}
function resetCropBox(){
    return SmartImageEditor.resetCropBox(smartImageEditorHost());
}
function updatePreviewNavButtons(){
    return SmartMediaPreview.updatePreviewNavButtons(smartMediaPreviewHost());
}
function navigatePreviewImage(delta){
    return SmartMediaPreview.navigatePreviewImage(smartMediaPreviewHost(), delta);
}
function openImagePreview(nodeId, imageIndex=0){
    return SmartMediaPreview.openImagePreview(smartMediaPreviewHost(), nodeId, imageIndex);
}
// 双击组内图片时按整组预览；非分组成员退回单节点预览。
function openImagePreviewSmart(nodeId, imageIndex=0){
    return SmartMediaPreview.openImagePreviewSmart(smartMediaPreviewHost(), nodeId, imageIndex);
}
// 打开整组图片预览：以被双击图片为起点，左右切换遍历分组内所有图片。
function openGroupImagePreview(group, startNodeId, startIndex=0){
    return SmartMediaPreview.openGroupImagePreview(smartMediaPreviewHost(), group, startNodeId, startIndex);
}
function openImageEditor(nodeId, imageIndex=0){
    return SmartImageEditor.openImageEditor(smartImageEditorHost(), nodeId, imageIndex);
}
function closeImageEditor(){
    return SmartImageEditor.closeImageEditor(smartImageEditorHost());
}
function clampCrop(){
    return SmartImageEditor.clampCrop(smartImageEditorHost());
}
function beginCropDrag(event, mode){
    return SmartImageEditor.beginCropDrag(smartImageEditorHost(), event, mode);
}
function resizeOutpaintFromDrag(dx, dy){
    return SmartImageEditor.resizeOutpaintFromDrag(smartImageEditorHost(), dx, dy);
}
function clampAspectCropToBounds(anchorX, anchorY, movingX, movingY, ratio, handle){
    return SmartImageEditor.clampAspectCropToBounds(smartImageEditorHost(), anchorX, anchorY, movingX, movingY, ratio, handle);
}
function resizeCropFromDrag(dx, dy){
    return SmartImageEditor.resizeCropFromDrag(smartImageEditorHost(), dx, dy);
}
async function uploadCroppedBlob(blob, name, isCurrent){
    return SmartImageEditor.uploadCroppedBlob(smartImageEditorHost(), blob, name, isCurrent);
}
async function uploadImageBlobs(blobs, isCurrent){
    return SmartImageEditor.uploadImageBlobs(smartImageEditorHost(), blobs, isCurrent);
}
function replaceEditedImage(file, extra={}){
    return SmartImageEditor.replaceEditedImage(smartImageEditorHost(), file, extra);
}
function applyOutpaintSizeToSmartParams(width, height){
    return SmartImageEditor.applyOutpaintSizeToSmartParams(smartImageEditorHost(), width, height);
}
async function applyImageCrop(){
    return SmartImageEditor.applyImageCrop(smartImageEditorHost());
}
async function applyImageOutpaint(){
    return SmartImageEditor.applyImageOutpaint(smartImageEditorHost());
}
async function applyImageMask(){
    return SmartEditorDraw.applyImageMask(smartEditorDrawHost());
}
function maskCanvasFromDrawCanvas(src){
    return SmartEditorDraw.maskCanvasFromDrawCanvas(smartEditorDrawHost(), src);
}
async function applyImageBrush(){
    return SmartEditorDraw.applyImageBrush(smartEditorDrawHost());
}
async function applyImageGridSplit(){
    return SmartEditorGrid.applyImageGridSplit(smartEditorGridHost());
}
function loadGridJoinImage(entry){
    return SmartEditorGrid.loadGridJoinImage(smartEditorGridHost(), entry);
}
function drawImageCover(ctx, img, dx, dy, dw, dh){
    return SmartEditorGrid.drawImageCover(smartEditorGridHost(), ctx, img, dx, dy, dw, dh);
}
async function applyImageGridJoin(){
    return SmartEditorGrid.applyImageGridJoin(smartEditorGridHost());
}
async function applyImageResize(){
    return SmartImageEditor.applyImageResize(smartImageEditorHost());
}
function applyImageEdit(){
    return SmartImageEditor.applyImageEdit(smartImageEditorHost());
}
let lastComposerNodeId = '';
let activeComposerSubject = null;
function currentComposerSubject(){
    return selectedNode();
}
function savePromptDraftForCurrent(){
    if(promptInput?.dataset?.promptLocked === '1') return;
    const subject = activeComposerNode();
    if(!subject) return;
    if(promptInput?.dataset?.preserveDraftOnce === '1' && subject.promptDraftHtml){
        delete promptInput.dataset.preserveDraftOnce;
        return;
    }
    subject.promptDraftHtml = promptInput.innerHTML;
    subject.promptDraftText = promptPlainText();
    subject.runSettings = cloneSmartSettings(settings);
}
function setPromptDraftForNode(node, text){
    if(!isSmartRunnableNode(node)) return;
    const value = String(text || '');
    node.promptDraftHtml = escapeHtml(value);
    node.promptDraftText = value;
    node.promptDraftTouched = true;
    if(activeSettingsSubject()?.id === node.id && promptInput){
        promptInput.textContent = value;
        delete promptInput.dataset.preserveDraftOnce;
    }
}
function loadPromptDraft(subject){
    if(subject?.promptDraftTouched === true){
        const html=String(subject.promptDraftHtml || '');
        promptInput.innerHTML=html.includes('mention-image-token') ? html : (promptHtmlWithMentionTokens(subject.promptDraftText || '',subject.runPromptRefs || []) || html);
        return;
    }
    if(subject?.promptDraftHtml){
        const hasToken = String(subject.promptDraftHtml || '').includes('mention-image-token');
        promptInput.innerHTML = hasToken
            ? subject.promptDraftHtml
            : (promptHtmlWithMentionTokens(subject.runPrompt || subject.promptDraftText || '', subject.runPromptRefs || []) || subject.promptDraftHtml);
    } else if(typeof subject?.runPrompt === 'string'){
        const rebuilt = promptHtmlWithMentionTokens(subject.runPrompt, subject.runPromptRefs || []);
        if(rebuilt) promptInput.innerHTML = rebuilt;
        else setPromptText(subject.runPrompt);
    } else {
        setPromptText('');
    }
}
function positionComposerForNode(node){
    if(!node) return;
    const rect = nodeRect(node);
    const nodeEl = world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"]`);
    const height = nodeEl?.querySelector('.audio-smart-node')
        ? Math.max(rect.height, nodeEl.offsetHeight) : rect.height;
    const gap = 14;
    const cardW = 540;
    composer.style.width = `${cardW}px`;
    composer.style.left = `${rect.x + rect.width / 2 - cardW / 2}px`;
    composer.style.top = `${rect.y + height + gap}px`;
}
function smartComposerSchedulerHost(){
    return {
        get window(){return window;},
        captureCanvasContext:()=>smartMediaInputController.capture(),
        selectedNode:()=>selectedNode(),
        updateComposer:()=>updateComposer(),
        setTimeout:(...args)=>setTimeout(...args),
        clearTimeout:(...args)=>clearTimeout(...args)
    };
}
const smartComposerScheduler=SmartComposerScheduler.create(smartComposerSchedulerHost);
function scheduleComposerUpdate(delay=120){
    return smartComposerScheduler.schedule(delay);
}
function updateComposer(){
    if(!smartComposerScheduler.beginUpdate()) return;
    const node = selectedNode();
    syncRunButtonState(node);
    if(smartCascadeSilentSelection && !activeComposerSubject){
        composer.classList.remove('open');
        if(cascadeRunBtn) cascadeRunBtn.style.display = 'none';
        activeComposerSubject = null;
        lastComposerNodeId = '';
        return;
    }

    composer.classList.toggle('open', !!node);
    if(!isSmartRunnableNode(node)){
        if(cascadeRunBtn) cascadeRunBtn.style.display = 'none';
        savePromptDraftForCurrent();
        composer.classList.remove('open');
        activeComposerSubject = null;
        lastComposerNodeId = '';
        setPromptInputLocked(false);
        if(!node) setPromptText('');
        return;
    }
    // composer 只绑定节点本身：图片只是素材/结果，不携带提示词或参数状态。
    const subject = node;
    const composerKey = `${node.id}:node`;
    const switchedNode = lastComposerNodeId !== composerKey;
    if(switchedNode) savePromptDraftForCurrent();
    lastComposerNodeId = composerKey;
    activeComposerSubject = subject;
    const hasPromptInput = promptInputNodesFor(node).length > 0;
    if(switchedNode){
        settings = smartSettingsForNode(subject);
        loadPromptDraft(subject);
    }
    setPromptInputLocked(false);
    syncCascadeRunButton(node);
    positionComposerForNode(node);
    const ph = Math.max(60, Math.min(380, Number(settings.promptH) || 124));
    promptInput.style.setProperty('--prompt-h', `${ph}px`);
    renderInputThumbsRow(node);
    renderInputPromptPreview(node);
    syncCascadeRunButton(node);
    scheduleDynamicParamsRefresh(140);
}
function smartInputHost(){
    return {
        get Node(){return Node;},
        get SMART_REFERENCE_IMAGE_MAX(){return SMART_REFERENCE_IMAGE_MAX;},
        get canvas(){return canvas;},
        get inputPromptPreview(){return inputPromptPreview;},
        get inputThumbsRow(){return inputThumbsRow;},
        get mentionInsertMode(){return mentionInsertMode;},
        get nodes(){return nodes;},
        get promptInput(){return promptInput;},
        get settings(){return settings;},
        get smartLoopContext(){return smartLoopContext;},
        bindSmartPreviewImageFallbacks:(...args)=>bindSmartPreviewImageFallbacks(...args),
        blockedInputRefKeys:(...args)=>blockedInputRefKeys(...args),
        defaultReferenceImagesFor:(...args)=>defaultReferenceImagesFor(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        inputNodesFor:(...args)=>inputNodesFor(...args),
        inputPromptTextFor:(...args)=>inputPromptTextFor(...args),
        inputRefKey:(...args)=>inputRefKey(...args),
        isSelfReferenceForNode:(...args)=>isSelfReferenceForNode(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        isVideoMediaItem:(...args)=>isVideoMediaItem(...args),
        loadNodePromptDraftToInput:(...args)=>loadNodePromptDraftToInput(...args),
        manualReferenceImagesFor:(...args)=>manualReferenceImagesFor(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        pushUndo:(...args)=>pushUndo(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        removeManualReferenceFromSelectedNode:(...args)=>removeManualReferenceFromSelectedNode(...args),
        render:(...args)=>render(...args),
        rhDefaultPromptSuggestion:(...args)=>rhDefaultPromptSuggestion(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setCurrentSmartManualVideoUrl:(...args)=>setCurrentSmartManualVideoUrl(...args),
        smartImageMode:(...args)=>smartImageMode(...args),
        smartImageUsesWorkflowInput:(...args)=>smartImageUsesWorkflowInput(...args),
        smartPreviewImgHtml:(...args)=>smartPreviewImgHtml(...args),
        smartVideoPreviewHtml:(...args)=>smartVideoPreviewHtml(...args),
        syncJimengModelPillForRefs:(...args)=>syncJimengModelPillForRefs(...args),
        syncJimengVideoModelPillForRefs:(...args)=>syncJimengVideoModelPillForRefs(...args),
        textForNode:(...args)=>textForNode(...args),
        toast:(...args)=>toast(...args),
        toggleAssetMentionPickerFromThumbs:(...args)=>toggleAssetMentionPickerFromThumbs(...args),
        tr:(...args)=>tr(...args),
        uniqueReferenceImages:(...args)=>uniqueReferenceImages(...args),
        uploadCurrentSmartVideosToCloud:(...args)=>uploadCurrentSmartVideosToCloud(...args),
        visibleReferenceImagesFor:(...args)=>visibleReferenceImagesFor(...args),
        workflowInputNodesFor:(...args)=>workflowInputNodesFor(...args)
    };
}
function renderInputPromptPreview(node){
    return SmartInputThumbs.renderInputPromptPreview(smartInputHost(), node);
}
function renderInputThumbsRow(node){
    return SmartInputThumbs.renderInputThumbsRow(smartInputHost(), node);
}
function bindInputThumbReferenceActions(){
    return SmartInputThumbs.bindInputThumbReferenceActions(smartInputHost());
}
function bindInputThumbsDrag(node, items, manualRefKeys=new Set()){
    return SmartInputThumbs.bindInputThumbsDrag(smartInputHost(), node, items, manualRefKeys);
}
function reorderManualInputRefs(currentNode, fromKey, targetKey, placement='before'){
    return SmartInputThumbs.reorderManualInputRefs(smartInputHost(), currentNode, fromKey, targetKey, placement);
}
function inputThumbDropPlacement(el, event){
    return SmartInputThumbs.inputThumbDropPlacement(smartInputHost(), el, event);
}
function clearInputThumbDropMarkers(){
    return SmartInputThumbs.clearInputThumbDropMarkers(smartInputHost());
}
function bindInputThumbVideoActions(){
    return SmartInputThumbs.bindInputThumbVideoActions(smartInputHost());
}
function movedBeforeAfterIds(ids, movedId, targetId, placement='before'){
    return SmartInputThumbs.movedBeforeAfterIds(smartInputHost(), ids, movedId, targetId, placement);
}
function sameOrderedIds(a, b){
    return SmartInputThumbs.sameOrderedIds(smartInputHost(), a, b);
}
function reorderInputSourceNodes(currentNode, movedId, targetId, placement='before'){
    return SmartInputThumbs.reorderInputSourceNodes(smartInputHost(), currentNode, movedId, targetId, placement);
}
function reorderInputThumb(currentNode, items, from, to, placement='before'){
    return SmartInputThumbs.reorderInputThumb(smartInputHost(), currentNode, items, from, to, placement);
}
function smartMediaInputHost(){
    return {
        get canvas(){return typeof canvas==='undefined'?null:canvas;},
        get nodes(){return nodes;},
        get selectedId(){return selectedId;},
        get nodeClipboard(){return nodeClipboard;},
        get document(){return document;},
        get window(){return window;},
        get shell(){return typeof shell==='undefined'?null:shell;},
        get fileInput(){return typeof fileInput==='undefined'?null:fileInput;},
        get workflowInput(){return typeof smartWorkflowImportInput==='undefined'?null:smartWorkflowImportInput;},
        get pendingGroupUploadPoint(){return typeof pendingGroupUploadPoint==='undefined'?null:pendingGroupUploadPoint;},
        set pendingGroupUploadPoint(value){pendingGroupUploadPoint=value;},
        get uploadTargetId(){return typeof uploadTargetId==='undefined'?'':uploadTargetId;},
        set uploadTargetId(value){uploadTargetId=value;},
        set lastImagePasteAt(value){lastImagePasteAt=value;},
        handleFiles:(...args)=>handleFiles(...args),
        handleSmartImageDropPayload:(...args)=>handleSmartImageDropPayload(...args),
        importSmartWorkflowFile:(...args)=>importSmartWorkflowFile(...args),
        resolveSmartImageDropPayload:(...args)=>resolveSmartImageDropPayload(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        setSmartDropCopyEffect:(...args)=>setSmartDropCopyEffect(...args),
        assetNodeImageFromItem:(...args)=>assetNodeImageFromItem(...args),
        createImageNodeAt:(...args)=>createImageNodeAt(...args),
        pushUndo:(...args)=>pushUndo(...args),
        isSupportedUploadFile:(...args)=>isSupportedUploadFile(...args),
        isEditableTarget:(...args)=>isEditableTarget(...args),
        pasteAssetsFromInbox:(...args)=>pasteAssetsFromInbox(...args),
        pasteNodes:(...args)=>pasteNodes(...args)
    };
}
const smartMediaInputController=SmartMediaInputEvents.create(smartMediaInputHost);
function smartDeferredActionsHost(){
    return {
        get window(){return window;},
        get document(){return document;},
        get nodes(){return nodes;},
        get runBtn(){return runBtn;},
        get nodeClipboard(){return nodeClipboard;},
        get lastImagePasteAt(){return lastImagePasteAt;},
        get lastNodePasteAt(){return lastNodePasteAt;},
        captureCanvasContext:()=>smartMediaInputController.capture(),
        setTimeout:(...args)=>setTimeout(...args),
        clearTimeout:(...args)=>clearTimeout(...args),
        syncRunButtonState:()=>syncRunButtonState(),
        render:()=>render(),
        isEditableTarget:(target)=>isEditableTarget(target),
        pasteNodes:()=>pasteNodes()
    };
}
const smartDeferredActions=SmartDeferredActions.create(smartDeferredActionsHost);
function smartUploadHost(){
    return {
        captureMediaInputContext:()=>smartMediaInputController.capture(),
        get DOMParser(){return DOMParser;},
        get File(){return File;},
        get SMART_IMAGE_DROP_EXT_RE(){return SMART_IMAGE_DROP_EXT_RE;},
        get SMART_IMAGE_DROP_TEXT_TYPES(){return SMART_IMAGE_DROP_TEXT_TYPES;},
        get SMART_IMAGE_DROP_TYPE_HINT_RE(){return SMART_IMAGE_DROP_TYPE_HINT_RE;},
        get SMART_UPLOAD_MAX(){return SMART_UPLOAD_MAX;},
        get SMART_UPLOAD_MAX_BATCH_BYTES(){return SMART_UPLOAD_MAX_BATCH_BYTES;},
        get SMART_UPLOAD_MAX_FILE_BYTES(){return SMART_UPLOAD_MAX_FILE_BYTES;},
        get URL(){return URL;},
        get nodes(){return nodes;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get undoSuppressed(){return undoSuppressed;},
        set undoSuppressed(value){undoSuppressed=value;},
        get window(){return window;},
        addNodeToSmartGroup:(...args)=>addNodeToSmartGroup(...args),
        createImageNodeAt:(...args)=>createImageNodeAt(...args),
        fetch:(...args)=>fetch(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        isSupportedUploadFile:(...args)=>isSupportedUploadFile(...args),
        mediaKindForFile:(...args)=>mediaKindForFile(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        nodeRect:(...args)=>nodeRect(...args),
        nodeScale:(...args)=>nodeScale(...args),
        pushUndo:(...args)=>pushUndo(...args),
        render:(...args)=>render(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedNode:(...args)=>selectedNode(...args),
        smartImageNameFromUrl:(...args)=>smartImageNameFromUrl(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        viewportCenter:(...args)=>viewportCenter(...args)
    };
}
function isSupportedUploadFile(file){
    return SmartMediaDrop.isSupportedUploadFile(smartUploadHost(), file);
}
function dataTransferItemEntry(item){
    return SmartMediaDrop.dataTransferItemEntry(smartUploadHost(), item);
}
async function filesFromEntry(entry){
    return SmartMediaDrop.filesFromEntry(smartUploadHost(), entry);
}
async function uploadFilesFromDataTransfer(dataTransfer){
    return SmartMediaDrop.uploadFilesFromDataTransfer(smartUploadHost(), dataTransfer);
}
function uploadTitleForItems(items, fallback='Upload'){
    return SmartUploadCoordination.uploadTitleForItems(smartUploadHost(), items, fallback);
}
const SMART_IMAGE_DROP_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const SMART_IMAGE_DROP_TEXT_TYPES = [
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
const SMART_IMAGE_DROP_TYPE_HINT_RE = /^(?:files?|image\/.+|text\/(?:uri-list|html|plain|x-moz-url|x-file-url)|downloadurl|public\.(?:file-url|url)|uniformresourcelocator|filenamew?)$|application\/x-qt-(?:windows-mime|image)|application\/x-moz-file|com\.eagle/i;
function smartImageFilesFromDataTransfer(dataTransfer){
    return SmartMediaDrop.smartImageFilesFromDataTransfer(smartUploadHost(), dataTransfer);
}
async function smartResponseErrorMessage(response, fallback='请求失败'){
    return SmartUploadCoordination.smartResponseErrorMessage(smartUploadHost(), response, fallback);
}
function smartDropDataTypes(dataTransfer){
    return SmartMediaDrop.smartDropDataTypes(smartUploadHost(), dataTransfer);
}
function readSmartDropData(dataTransfer, type){
    return SmartMediaDrop.readSmartDropData(smartUploadHost(), dataTransfer, type);
}
function decodeSmartDropText(value){
    return SmartMediaDrop.decodeSmartDropText(smartUploadHost(), value);
}
function smartDropTextFragments(value){
    return SmartMediaDrop.smartDropTextFragments(smartUploadHost(), value);
}
function uniqueSmartDropValues(values){
    return SmartMediaDrop.uniqueSmartDropValues(smartUploadHost(), values);
}
function smartDropTextCandidates(dataTransfer){
    return SmartMediaDrop.smartDropTextCandidates(smartUploadHost(), dataTransfer);
}
function isRemoteSmartImageDropValue(value){
    return SmartMediaDrop.isRemoteSmartImageDropValue(smartUploadHost(), value);
}
function isLocalSmartImageDropValue(value){
    return SmartMediaDrop.isLocalSmartImageDropValue(smartUploadHost(), value);
}
function smartLocalImagePathsFromDataTransfer(dataTransfer){
    return SmartMediaDrop.smartLocalImagePathsFromDataTransfer(smartUploadHost(), dataTransfer);
}
function smartImageNameFromUrl(url){
    return SmartMediaDrop.smartImageNameFromUrl(smartUploadHost(), url);
}
function smartImageDropPayload(dataTransfer){
    return SmartMediaDrop.smartImageDropPayload(smartUploadHost(), dataTransfer);
}
async function resolveSmartImageDropPayload(dataTransfer){
    return SmartMediaDrop.resolveSmartImageDropPayload(smartUploadHost(), dataTransfer);
}
function hasSmartImageDropData(dataTransfer){
    return SmartMediaDrop.hasSmartImageDropData(smartUploadHost(), dataTransfer);
}
function hasSmartAssetDrag(dataTransfer){
    return SmartMediaDrop.hasSmartAssetDrag(smartUploadHost(), dataTransfer);
}
function hasMediaDrawerDrag(dataTransfer){
    return SmartMediaDrop.hasMediaDrawerDrag(smartUploadHost(), dataTransfer);
}
function hasSmartInputThumbDrag(dataTransfer){
    return SmartMediaDrop.hasSmartInputThumbDrag(smartUploadHost(), dataTransfer);
}
function setSmartDropCopyEffect(e, includeAsset=false){
    return SmartMediaDrop.setSmartDropCopyEffect(smartUploadHost(), e, includeAsset);
}
async function uploadFiles(files){
    return SmartUploadCoordination.uploadFiles(smartUploadHost(), files);
}
function appendImagesToSmartNode(uploaded, targetId='', opts={}){
    return SmartUploadCoordination.appendImagesToSmartNode(smartUploadHost(), uploaded, targetId, opts);
}
async function handleFiles(files, targetId='', opts={}){
    return SmartUploadCoordination.handleFiles(smartUploadHost(), files, targetId, opts);
}
async function importSmartLocalImages(paths){
    return SmartUploadCoordination.importSmartLocalImages(smartUploadHost(), paths);
}
async function handleSmartImageDropPayload(payload, targetId='', opts={}){
    return SmartUploadCoordination.handleSmartImageDropPayload(smartUploadHost(), payload, targetId, opts);
}
function sizeForRun(sourceSettings=settings){
    return SmartNodeParams.sizeForRun(smartNodeParamsHost(), sourceSettings);
}
function expectedOutputSize(){
    return SmartNodeParams.expectedOutputSize(smartNodeParamsHost());
}
function explicitRequestOutputSizeForPending(){
    return SmartNodeParams.explicitRequestOutputSizeForPending(smartNodeParamsHost());
}
function pendingSizeFromImageRef(img){
    return SmartNodeParams.pendingSizeFromImageRef(smartNodeParamsHost(), img);
}
function pendingSourceBoxSize(options={}){
    const sourceNode = options.sourceNode || null;
    if(sourceNode && (sourceNode.images || []).length){
        const rect = nodeRect(sourceNode);
        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};
    }
    const ref = (options.refs || []).find(img => img?.url);
    const refSize = pendingSizeFromImageRef(ref);
    if(refSize) return refSize;
    const refNode = ref?.nodeId ? nodes.find(n => n.id === ref.nodeId) : null;
    if(refNode){
        const rect = nodeRect(refNode);
        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};
    }
    return null;
}
function displayBoxFromNaturalSize(size){
    const layout = singleImageLayout(
        {natural_w:size?.w || size?.width || 1024, natural_h:size?.h || size?.height || 1024},
        {type:'smart-image', images:[{}]},
        MEDIA_NODE_DEFAULT_SCALE
    );
    return {w:layout.width, h:layout.height};
}
function pendingBaseBoxSize(options={}){
    const requestSize = explicitRequestOutputSizeForPending();
    if(requestSize) return displayBoxFromNaturalSize(requestSize);
    const sourceSize = pendingSourceBoxSize(options);
    if(sourceSize?.display) return {w:sourceSize.w, h:sourceSize.h};
    if(sourceSize) return displayBoxFromNaturalSize(sourceSize);
    return displayBoxFromNaturalSize(expectedOutputSize());
}
function pendingBoxSize(count, options={}){
    const base = pendingBaseBoxSize(options);
    const aspect = base.w / Math.max(1, base.h);
    const c = Math.max(1, Number(count) || 1);
    if(c <= 1){
        return {w:Math.round(base.w), h:Math.round(base.h)};
    }
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(c))));
    const rows = Math.ceil(c / cols);
    const cellMax = Math.max(96, Math.min(220, Math.max(base.w, base.h) * 0.42));
    let cellW, cellH;
    if(base.w >= base.h){
        cellW = cellMax;
        cellH = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax / aspect));
    } else {
        cellH = cellMax;
        cellW = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax * aspect));
    }
    const w = cols * (cellW + 8) + 16;
    const h = rows * (cellH + 8) + 16;
    return {w, h};
}
function smartMentionHost(){
    return {
        get Node(){return Node;},
        get NodeFilter(){return NodeFilter;},
        get SMART_REFERENCE_IMAGE_MAX(){return SMART_REFERENCE_IMAGE_MAX;},
        get activeAssetCategoryId(){return activeAssetCategoryId;},
        set activeAssetCategoryId(value){activeAssetCategoryId=value;},
        get activeAssetLibraryId(){return activeAssetLibraryId;},
        set activeAssetLibraryId(value){activeAssetLibraryId=value;},
        get assetLibrary(){return assetLibrary;},
        get document(){return document;},
        get inputThumbsRow(){return inputThumbsRow;},
        get mentionAnchorEl(){return mentionAnchorEl;},
        set mentionAnchorEl(value){mentionAnchorEl=value;},
        get mentionAssetCategoryId(){return mentionAssetCategoryId;},
        set mentionAssetCategoryId(value){mentionAssetCategoryId=value;},
        get mentionInsertMode(){return mentionInsertMode;},
        set mentionInsertMode(value){mentionInsertMode=value;},
        get mentionPicker(){return mentionPicker;},
        get mentionRange(){return mentionRange;},
        set mentionRange(value){mentionRange=value;},
        get mentionSource(){return mentionSource;},
        set mentionSource(value){mentionSource=value;},
        get promptInput(){return promptInput;},
        get promptResize(){return promptResize;},
        get viewport(){return typeof viewport==='undefined'?undefined:viewport;},
        get window(){return window;},
        assetCategories:(...args)=>assetCategories(...args),
        assetCategoryForMention:(...args)=>assetCategoryForMention(...args),
        assetLibraries:(...args)=>assetLibraries(...args),
        assetMediaKind:(...args)=>assetMediaKind(...args),
        bindSmartPreviewImageFallbacks:(...args)=>bindSmartPreviewImageFallbacks(...args),
        collectPromptParts:(...args)=>collectPromptParts(...args),
        defaultReferenceImagesFor:(...args)=>defaultReferenceImagesFor(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        inputRefKey:(...args)=>inputRefKey(...args),
        lineImagesFor:(...args)=>lineImagesFor(...args),
        manualReferenceImagesFor:(...args)=>manualReferenceImagesFor(...args),
        mediaKindForItem:(...args)=>mediaKindForItem(...args),
        pushUndo:(...args)=>pushUndo(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        renderAssetLibrary:(...args)=>renderAssetLibrary(...args),
        renderInputThumbsRow:(...args)=>renderInputThumbsRow(...args),
        savePromptDraftForCurrent:(...args)=>savePromptDraftForCurrent(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedNode:(...args)=>selectedNode(...args),
        smartPreviewImgHtml:(...args)=>smartPreviewImgHtml(...args),
        smartVideoPreviewHtml:(...args)=>smartVideoPreviewHtml(...args),
        tr:(...args)=>tr(...args)
    };
}
function mentionTokenHtml(img){
    return SmartMentions.mentionTokenHtml(smartMentionHost(), img);
}
function mentionTokenMediaHtml(img, kind=mediaKindForItem(img)){
    return SmartMentions.mentionTokenMediaHtml(smartMentionHost(), img, kind);
}
function mentionOptionMediaHtml(img){
    return SmartMentions.mentionOptionMediaHtml(smartMentionHost(), img);
}
function promptHtmlWithMentionTokens(text, refs=[]){
    return SmartMentions.promptHtmlWithMentionTokens(smartMentionHost(), text, refs);
}
function snapshotRunMeta(prompt, sourceId, displayPrompt='', refs=[]){
    return {
        prompt,
        displayPrompt:displayPrompt || promptPlainText() || prompt,
        promptHtml: promptInput ? promptInput.innerHTML : '',
        promptText: promptPlainText(),
        promptRefs:(refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? ''})).filter(ref => ref.url),
        inputRefs:(refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? '', kind:ref.kind || ''})).filter(ref => ref.url),
        sourceNodeId:sourceId,
        settings:JSON.parse(JSON.stringify(settings)),
        createdAt:Date.now()
    };
}
function attachRunMeta(targetNode, meta){
    if(!targetNode || !meta) return;
    targetNode.runPrompt = meta.displayPrompt || meta.promptText || meta.prompt;
    targetNode.runModelPrompt = meta.prompt;
    targetNode.runPromptRefs = meta.promptRefs || [];
    targetNode.runInputRefs = (meta.inputRefs || meta.promptRefs || []).map(ref => ({
        url:ref.url || '',
        name:ref.name || '',
        nodeId:ref.nodeId || '',
        imageIndex:ref.imageIndex ?? '',
        kind:ref.kind || ''
    })).filter(ref => ref.url);
    targetNode.runSettings = meta.settings;
    if(meta.sourceNodeId) targetNode.sourceNodeId = meta.sourceNodeId;
    else delete targetNode.sourceNodeId;
    targetNode.runAt = meta.createdAt;
    // 保存可编辑的 @-提及表单到草稿字段，方便点输出节点时还原原始可编辑形式
    if(meta.promptHtml != null){
        const htmlHasToken = String(meta.promptHtml || '').includes('mention-image-token');
        const rebuiltHtml = htmlHasToken ? '' : promptHtmlWithMentionTokens(meta.displayPrompt || meta.promptText || '', meta.promptRefs || []);
        targetNode.promptDraftHtml = htmlHasToken ? meta.promptHtml : (rebuiltHtml || meta.promptHtml);
        targetNode.promptDraftText = meta.promptText || '';
    }
    targetNode.images = (targetNode.images || []).map(img => stripImageGenerationMeta(img));
}
function stripRunInputMeta(meta){
    if(!meta) return meta;
    const cleanPrompt = meta.promptText || meta.displayPrompt || meta.prompt || '';
    return {
        ...meta,
        promptHtml:escapeHtml(cleanPrompt),
        promptText:cleanPrompt,
        promptRefs:[],
        inputRefs:meta.inputRefs || meta.promptRefs || [],
        sourceNodeId:''
    };
}
function stripImageGenerationMeta(img){
    if(!img) return img;
    delete img.runPrompt;
    delete img.runModelPrompt;
    delete img.runSettings;
    delete img.sourceNodeId;
    delete img.runAt;
    delete img.promptDraftHtml;
    delete img.promptDraftText;
    return img;
}
function addConnection(fromId, toId, kind='flow'){
    return SmartConnectionEdit.addConnection(smartNodeEditHost(), fromId, toId, kind);
}
function connectInputNode(fromId, toId){
    return SmartConnectionEdit.connectInputNode(smartNodeEditHost(), fromId, toId);
}
function smartGraphHost(){
    return {
        get canvas(){return canvas;},
        get canvasUsesConnections(){return canvasUsesConnections;},
        get nodes(){return nodes;},
        directImageInputsFor:(...args)=>directImageInputsFor(...args),
        directImageInputsForKinds:(...args)=>directImageInputsForKinds(...args),
        isHistoryGroupNode:(...args)=>isHistoryGroupNode(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        smartImageUsesWorkflowInput:(...args)=>smartImageUsesWorkflowInput(...args),
        smartLoopCount:(...args)=>smartLoopCount(...args)
    };
}
function upstreamNodesForKinds(node, kinds=['input']){
    return CanvasGraphRules.upstreamNodesForKinds(smartGraphHost(), node, kinds);
}
function inputNodesFor(node){
    return CanvasGraphRules.inputNodesFor(smartGraphHost(), node);
}
function workflowInputNodesFor(node){
    return CanvasGraphRules.workflowInputNodesFor(smartGraphHost(), node);
}
function clearDetachedRunInputRefs(node){
    if(!node) return;
    const hasUpstream = Boolean((canvas?.connections || []).some(conn => conn.to === node.id && ['input','flow'].includes(conn.kind || 'flow')));
    if(hasUpstream || (!canvasUsesConnections && Array.isArray(node.inputNodeIds) && node.inputNodeIds.some(id => nodes.some(n => n.id === id)))) return;
    delete node.runInputRefs;
    delete node.runPromptRefs;
    delete node.sourceNodeId;
}
function cleanupDetachedRunInputRefs(){
    if(!canvasUsesConnections) return false;
    let changed = false;
    nodes.forEach(node => {
        const hadRefs = Array.isArray(node?.runInputRefs) && node.runInputRefs.length;
        const hadPromptRefs = Array.isArray(node?.runPromptRefs) && node.runPromptRefs.length;
        const hadSource = Boolean(node?.sourceNodeId);
        clearDetachedRunInputRefs(node);
        if(hadRefs !== (Array.isArray(node?.runInputRefs) && node.runInputRefs.length)
            || hadPromptRefs !== (Array.isArray(node?.runPromptRefs) && node.runPromptRefs.length)
            || hadSource !== Boolean(node?.sourceNodeId)){
            changed = true;
        }
    });
    return changed;
}
function imagesForNode(node){
    if(isSmartGroupNode(node)){
        return smartGroupImageRefs(node).map((ref, index) => ({
            ...ref.item,
            nodeId:ref.nodeId,
            imageIndex:ref.index,
            groupNodeId:node.id,
            groupImageIndex:index
        }));
    }
    return (node?.images || []).map((img, index) => ({...imageForDisplay(img), nodeId:node.id, imageIndex:index}));
}
function nodeHasReferenceContent(node){
    return imagesForNode(node).some(img => img?.url);
}
function isSelfReferenceForNode(node, img){
    return Boolean(node?.id && img?.nodeId === node.id);
}
function candidateInputImagesFor(node, consume=false, ctx=smartLoopContext){
    const inputs = (smartImageUsesWorkflowInput(node, ctx) ? workflowInputImagesFor(node, consume, ctx) : inputImagesFor(node, consume, ctx))
        .filter(img => img?.url);
    if(!inputs.length) return [];
    if(smartImageUsesWorkflowInput(node, ctx)) return inputs;
    if(nodeHasReferenceContent(node)) return [];
    return inputs;
}
function defaultInputImagesFor(node, consume=false, ctx=smartLoopContext){
    return candidateInputImagesFor(node, consume, ctx);
}
function splitSmartPromptItems(text){
    const trimmed = String(text || '').trim();
    if(!trimmed) return [];
    const numbered = trimmed.split(/\s*(?:^|\s)\d+\s*[.、)）．]\s+/).map(s => s.trim()).filter(Boolean);
    if(numbered.length >= 2) return numbered;
    const lines = trimmed.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
    return lines.length >= 2 ? lines : [trimmed];
}
function smartLoopPromptFieldValues(node){
    const fields = Array.isArray(node?.variablePrompts)
        ? node.variablePrompts.map(text => String(text || '').trim())
        : [];
    if(fields.length) return fields;
    return splitSmartPromptItems(node?.variablePrompt || '');
}
function smartLoopActivePromptFieldValues(node){
    return smartLoopPromptFieldValues(node).filter(Boolean);
}
function smartLoopDefaultPromptText(){
    return tr('smart.loopDefaultPrompt') || '现在生成第《计数》张卖点图片';
}
function isSmartLoopDefaultPrompt(text){
    const value = String(text || '').trim();
    if(!value) return false;
    return value === smartLoopDefaultPromptText()
        || value === '现在生成第《计数》张卖点图片'
        || value === 'Generate selling-point image 《计数》';
}
function setSmartLoopPromptFieldValues(node, values){
    if(!node || node.type !== 'smart-loop') return;
    const fields = (values || []).map(text => String(text || '').trim());
    node.variablePrompts = fields.length ? fields : [''];
    node.variablePrompt = fields.filter(Boolean).join('\n');
}
function smartLoopPromptFieldText(node, fieldIndex){
    const values = smartLoopPromptFieldValues(node);
    return values[fieldIndex] || '';
}
function smartLoopSelectedLocalPrompt(node, ctx=smartLoopContext){
    const values = smartLoopActivePromptFieldValues(node);
    if(!values.length) return '';
    const startBase = Math.max(1, Number(node?.loopStart) || 1);
    const index = Math.max(1, Number(ctx?.index || startBase) || startBase);
    return values[(index - 1) % values.length] || '';
}
function smartLoopUpstreamPromptPreviewHeight(node){
    return smartLoopInputPromptItems(node).length ? 78 : 0;
}
const smartLoopPromptVisiting = new Set();
function smartLoopInputPromptItems(node){
    if(!node?.showPrompt || smartLoopPromptVisiting.has(node.id)) return [];
    smartLoopPromptVisiting.add(node.id);
    try {
        return inputNodesFor(node)
            .flatMap(input => promptTextItemsForNode(input))
            .map(text => String(text || '').trim())
            .filter(Boolean);
    } finally {
        smartLoopPromptVisiting.delete(node.id);
    }
}
function smartLoopSelectedInputPrompt(node, ctx=smartLoopContext){
    const items = smartLoopInputPromptItems(node);
    if(!items.length) return '';
    const startBase = Math.max(1, Number(node?.loopStart) || 1);
    const index = Math.max(1, Number(ctx?.index || startBase) || startBase);
    return items[(index - 1) % items.length] || '';
}
function smartLoopPrompt(node, ctx=smartLoopContext){
    if(!node?.showPrompt) return '';
    const count = smartLoopCount(node);
    const startBase = Math.max(1, Number(node.loopStart) || 1);
    const index = Math.max(1, Number(ctx?.index || startBase) || startBase);
    const total = Math.max(1, Number(ctx?.total || count) || count);
    const selected = smartLoopSelectedInputPrompt(node, ctx);
    const localPrompt = smartLoopSelectedLocalPrompt(node, ctx);
    const effectiveLocalPrompt = selected && isSmartLoopDefaultPrompt(localPrompt) ? '' : localPrompt;
    const combined = [selected, effectiveLocalPrompt].map(text => String(text || '').trim()).filter(Boolean).join('\n\n');
    return String(combined || '')
        .replaceAll('《计数》', String(index))
        .replaceAll('[计数]', String(index))
        .replaceAll(`[${tr('canvas.counterToken')}]`, String(index))
        .replaceAll('《总数》', String(total))
        .replaceAll('[总数]', String(total))
        .replaceAll('《进度》', `${index}/${total}`)
        .replaceAll('[进度]', `${index}/${total}`)
        .trim();
}
function smartLoopInputImages(node, ctx=smartLoopContext){
    if(!node?.imageInput) return [];
    const refs = inputNodesFor(node).flatMap(input => {
        if(input?.type === 'smart-loop') return smartLoopInputImages(input, ctx);
        return imagesForNode(input);
    }).filter(img => img?.url);
    if(!refs.length) return [];
    const startBase = Math.max(1, Number(node.loopStart) || 1);
    const batchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
    return refs.slice(Math.max(0, currentIndex - 1), Math.max(0, currentIndex - 1) + batchSize)
        .map((img, i) => ({...img, name:img.name || trf('canvas.loopImageLabel', {n:currentIndex + i})}));
}
function smartLoopPreviewImages(node){
    if(!node?.imageInput) return [];
    return inputNodesFor(node).flatMap(input => {
        if(input?.type === 'smart-loop') return smartLoopInputImages(input, {index:Number(node.loopStart) || 1});
        return imagesForNode(input);
    }).filter(img => img?.url);
}
function outputImagesForNode(node, consume=false, ctx=smartLoopContext){
    if(node?.type === 'smart-group') return imagesForNode(node).filter(img => img?.url);
    if(node?.type === 'smart-loop') return smartLoopInputImages(node, ctx);
    const roundOutputs = ctx?.roundOutputs;
    if(node?.id && roundOutputs && typeof roundOutputs.get === 'function' && roundOutputs.has(node.id)){
        return (roundOutputs.get(node.id) || []).filter(img => img?.url);
    }
    return imagesForNode(node).filter(img => img?.url);
}
function selfReferenceImagesForNode(node, consume=false, ctx=smartLoopContext){
    return outputImagesForNode(node, consume, ctx).filter(img => img?.url);
}
function textForNode(node, ctx=smartLoopContext){
    if(!node) return '';
    if(isSmartImageNode(node)&&node.audioOutputText)return node.audioOutputText;
    if(node.type === 'smart-prompt') return promptTextItemsForNode(node, ctx).join('\n\n');
    if(node.type === 'smart-loop') return smartLoopPrompt(node, ctx);
    if(node.type === 'smart-group') return smartGroupMembers(node).map(member => textForNode(member, ctx)).filter(Boolean).join('\n\n');
    return '';
}
function promptInputNodesFor(node){
    return inputNodesFor(node).filter(input => input?.type === 'smart-prompt' || input?.type === 'smart-loop' || input?.type === 'smart-group' || !!input?.audioOutputText);
}
function inputPromptTextFor(node, ctx=smartLoopContext){
    const directText = promptInputNodesFor(node).map(input => textForNode(input, ctx)).filter(Boolean);
    const relayText = Array.isArray(ctx?.relayPromptNodeIds)
        ? ctx.relayPromptNodeIds.map(id => nodes.find(n => n.id === id)).map(input => textForNode(input, ctx)).filter(Boolean)
        : [];
    const seen = new Set();
    return [...directText, ...relayText].filter(text => {
        const key = String(text || '').trim();
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).join('\n\n');
}
function upstreamLoopPromptNodesFor(node){
    return promptInputNodesFor(node).filter(input => input?.type === 'smart-loop' && input.showPrompt);
}
function inputImagesFor(node, consume=false, ctx=smartLoopContext){
    return inputNodesFor(node).flatMap(input => outputImagesForNode(input, consume, ctx));
}
function workflowInputImagesFor(node, consume=false, ctx=smartLoopContext){
    return workflowInputNodesFor(node).flatMap(input => outputImagesForNode(input, consume, ctx));
}
function rememberRoundOutputs(ctx, node, outputs){
    if(!ctx || !node?.id || !Array.isArray(outputs)) return outputs || [];
    if(!ctx.roundOutputs || typeof ctx.roundOutputs.set !== 'function') ctx.roundOutputs = new Map();
    ctx.roundOutputs.set(node.id, outputs.filter(img => img?.url).map(img => ({...img})));
    return outputs;
}
function inputRefKey(img){
    if(!img?.url) return '';
    const nodeId = img.nodeId || '';
    const imageIndex = Number.isFinite(Number(img.imageIndex)) ? String(Number(img.imageIndex)) : '';
    if(nodeId && imageIndex !== '') return `${nodeId}|${imageIndex}`;
    return `url|${img.url}`;
}
function blockedInputRefKeys(node){
    return new Set(Array.isArray(node?.blockedInputRefs) ? node.blockedInputRefs.filter(Boolean) : []);
}
function manualReferenceImagesFor(node){
    if(!node || !Array.isArray(node.manualInputRefs)) return [];
    return node.manualInputRefs.filter(img => img?.url).map((img, index) => ({
        ...img,
        kind:img.kind || mediaKindForItem(img),
        name:img.name || `图${index + 1}`,
        imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : index,
        manualAdded:true
    }));
}
function isInputRefBlocked(node, img){
    if(!node || !img?.url) return false;
    return blockedInputRefKeys(node).has(inputRefKey(img));
}
function activeInputImagesFor(node, consume=false, ctx=smartLoopContext){
    return inputImagesFor(node, consume, ctx).filter(img => img?.url && !isInputRefBlocked(node, img));
}
function toggleInputRefBlocked(node, img){
    if(!node || !img?.url) return;
    const key = inputRefKey(img);
    if(!key) return;
    pushUndo();
    const blocked = blockedInputRefKeys(node);
    if(blocked.has(key)) blocked.delete(key);
    else blocked.add(key);
    node.blockedInputRefs = [...blocked];
    if(!node.blockedInputRefs.length) delete node.blockedInputRefs;
    renderInputThumbsRow(node);
    scheduleSave();
}
function defaultReferenceImagesFor(node, consume=false, ctx=smartLoopContext){
    if(!node) return [];
    const self = selfReferenceImagesForNode(node, consume, ctx).filter(img => img?.url);
    const upstream = (smartImageUsesWorkflowInput(node, ctx) ? workflowInputImagesFor(node, consume, ctx) : inputImagesFor(node, consume, ctx))
        .filter(img => img?.url);
    const manual = manualReferenceImagesFor(node);
    if(smartImageUsesWorkflowInput(node, ctx)||node.shotTableOrigin?.stage==='video') return uniqueReferenceImages([...upstream, ...manual]);
    if(self.length) return uniqueReferenceImages([...self, ...upstream, ...manual]);
    return uniqueReferenceImages([...upstream, ...manual]);
}
function lineConnectionsFor(node){
    return CanvasGraphRules.lineConnectionsFor(smartGraphHost(), node);
}
function connectedLineNodeIds(node){
    return CanvasGraphRules.connectedLineNodeIds(smartGraphHost(), node);
}
function upstreamLineNodeIds(node){
    return CanvasGraphRules.upstreamLineNodeIds(smartGraphHost(), node);
}
function lineImagesFor(node){
    const ids = upstreamLineNodeIds(node);
    return ids.flatMap(id => {
        const source = nodes.find(n => n.id === id);
        return imagesForNode(source);
    }).filter(img => img?.url);
}
function collectMentionedImagesFromPrompt(){
    return SmartMentions.collectMentionedImagesFromPrompt(smartMentionHost());
}
function uniqueReferenceImages(images){
    return SmartMentions.uniqueReferenceImages(smartMentionHost(), images);
}
function visibleReferenceImagesFor(node){
    return SmartMentions.visibleReferenceImagesFor(smartMentionHost(), node);
}
function inputMentionCandidateImages(node){
    return SmartMentions.inputMentionCandidateImages(smartMentionHost(), node);
}
// 一个素材可注册到多个平台：收集所有「已通过」的 asset:// 地址，按平台映射。
function assetRegisteredUris(item){
    return SmartMentions.assetRegisteredUris(smartMentionHost(), item);
}
function assetMentionCandidateImages(categoryId=''){
    return SmartMentions.assetMentionCandidateImages(smartMentionHost(), categoryId);
}
function mentionCandidateImages(node, source=mentionSource){
    return SmartMentions.mentionCandidateImages(smartMentionHost(), node, source);
}
function referenceImagesFor(node){
    return defaultReferenceImagesFor(node);
}
function closeMentionPicker(){
    return SmartMentions.closeMentionPicker(smartMentionHost());
}
function saveMentionRange(){
    return SmartMentions.saveMentionRange(smartMentionHost());
}
function textBeforeCaret(){
    return SmartMentions.textBeforeCaret(smartMentionHost());
}
function renderMentionPicker(source){
    return SmartMentions.renderMentionPicker(smartMentionHost(), source);
}
function showMentionPicker(){
    return SmartMentions.showMentionPicker(smartMentionHost());
}
function setPromptCaretToEnd(){
    return SmartMentions.setPromptCaretToEnd(smartMentionHost());
}
function toggleAssetMentionPickerFromThumbs(){
    return SmartMentions.toggleAssetMentionPickerFromThumbs(smartMentionHost());
}
function addManualReferenceToSelectedNode(img){
    return SmartMentions.addManualReferenceToSelectedNode(smartMentionHost(), img);
}
function removeManualReferenceFromSelectedNode(key){
    return SmartMentions.removeManualReferenceFromSelectedNode(smartMentionHost(), key);
}
function placeMentionPickerInPromptRow(){
    return SmartMentions.placeMentionPickerInPromptRow(smartMentionHost());
}
function placeMentionPickerInComposerCard(){
    return SmartMentions.placeMentionPickerInComposerCard(smartMentionHost());
}
function positionMentionPickerAtCaret(){
    return SmartMentions.positionMentionPickerAtCaret(smartMentionHost());
}
function maybeOpenMentionPicker(){
    return SmartMentions.maybeOpenMentionPicker(smartMentionHost());
}
function insertMentionToken(img){
    return SmartMentions.insertMentionToken(smartMentionHost(), img);
}
function collectPromptParts(){
    return SmartPromptRequest.collectPromptParts(smartInputHost());
}
function originalPromptTextFromParts(parts){
    return SmartPromptRequest.originalPromptTextFromParts(smartInputHost(), parts);
}
function buildPromptRequest(node, overrideDefaultImages=null, consumeDefault=false, ctx=smartLoopContext){
    return SmartPromptRequest.buildPromptRequest(smartInputHost(), node, overrideDefaultImages, consumeDefault, ctx);
}
function outgoingConnectionsFor(node, kinds=['input']){
    return CanvasGraphRules.outgoingConnectionsFor(smartGraphHost(), node, kinds);
}
function outgoingInputConnectionsFor(node){
    return CanvasGraphRules.outgoingInputConnectionsFor(smartGraphHost(), node);
}
function nextOutputPositionForSource(sourceNode, pendingBox, options={}){
    return SmartOutputCoordination.nextOutputPositionForSource(smartOutputCoordinationHost(), sourceNode, pendingBox, options);
}
function createPendingOutputFromSource(sourceNode, expectedCount, meta, options={}){
    return SmartOutputCoordination.createPendingOutputFromSource(smartOutputCoordinationHost(), sourceNode, expectedCount, meta, options);
}
function createParallelLoopOutputNode(templateNode, sourceNode, roundIndex, roundOffset=0){
    return SmartOutputCoordination.createParallelLoopOutputNode(smartOutputCoordinationHost(), templateNode, sourceNode, roundIndex, roundOffset);
}
function loopOutputSlotsForRoot(rootNode){
    return SmartOutputCoordination.loopOutputSlotsForRoot(smartOutputCoordinationHost(), rootNode);
}
function loopOutputSlotForRound(rootNode, loopNode, roundIndex, slotIndex){
    return SmartOutputCoordination.loopOutputSlotForRound(smartOutputCoordinationHost(), rootNode, loopNode, roundIndex, slotIndex);
}
function tagLoopOutputSlot(output, rootNode, loopNode, roundIndex, slotIndex){
    return SmartOutputCoordination.tagLoopOutputSlot(smartOutputCoordinationHost(), output, rootNode, loopNode, roundIndex, slotIndex);
}
function createLoopOutputSlot(rootNode, roundIndex, roundOffset=0, options={}){
    return SmartOutputCoordination.createLoopOutputSlot(smartOutputCoordinationHost(), rootNode, roundIndex, roundOffset, options);
}
function extractCurrentImagesToSource(node, meta=null){
    return SmartOutputCoordination.extractCurrentImagesToSource(smartOutputCoordinationHost(), node, meta);
}
function finalizePendingNode(pendingNode, urls, meta, kind='image'){
    return SmartOutputCoordination.finalizePendingNode(smartOutputCoordinationHost(), pendingNode, urls, meta, kind);
}
function restoreFromExtraction(node, extracted){
    return SmartOutputCoordination.restoreFromExtraction(smartOutputCoordinationHost(), node, extracted);
}
function restoreSourceVisualState(node, state){
    return SmartOutputCoordination.restoreSourceVisualState(smartOutputCoordinationHost(), node, state);
}
function finishLoopTargetPreviewState(node){
    return SmartCascadeSteps.finishLoopTargetPreviewState(smartCascadeHost(), node);
}
function refsForDirectLoopRound(loopNode, loopIndex, total){
    return SmartCascadeSteps.refsForDirectLoopRound(smartCascadeHost(), loopNode, loopIndex, total);
}
function showDirectLoopRoundPreview(loopNode, target, refs, loopIndex, total){
    return SmartCascadeSteps.showDirectLoopRoundPreview(smartCascadeHost(), loopNode, target, refs, loopIndex, total);
}
function directImageInputsFor(node){
    const upstream = smartImageUsesWorkflowInput(node) ? workflowInputNodesFor(node) : inputNodesFor(node);
    return upstream
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n) && (n.images || []).some(img => img?.url))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return bx - ax;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function directImageInputsForKinds(node, kinds=['input']){
    const upstream = upstreamNodesForKinds(node, kinds);
    return upstream
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n) && (n.images || []).some(img => img?.url))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return bx - ax;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function primaryImageInputFor(node, options={}){
    return CanvasGraphRules.primaryImageInputFor(smartGraphHost(), node, options);
}
function hasDownstreamImageNode(node){
    return CanvasGraphRules.hasDownstreamImageNode(smartGraphHost(), node);
}
function isGeneratedOutputForNode(sourceNode, targetNode){
    return CanvasGraphRules.isGeneratedOutputForNode(smartGraphHost(), sourceNode, targetNode);
}
function downstreamWorkflowImageTargetsFor(node){
    return CanvasGraphRules.downstreamWorkflowImageTargetsFor(smartGraphHost(), node);
}
function hasDownstreamWorkflowImageNode(node){
    return CanvasGraphRules.hasDownstreamWorkflowImageNode(smartGraphHost(), node);
}
function smartImageChainTo(nodeId, options={}){
    return CanvasGraphRules.smartImageChainTo(smartGraphHost(), nodeId, options);
}
function upstreamNodesForId(nodeId, kinds=['input']){
    return CanvasGraphRules.upstreamNodesForId(smartGraphHost(), nodeId, kinds);
}
function resolveSmartCascadeLoop(nodeId){
    return CanvasGraphRules.resolveSmartCascadeLoop(smartGraphHost(), nodeId);
}
function relayLoopPromptNodesForEdge(sourceNode, targetNode){
    if(!sourceNode?.id || !targetNode?.id) return [];
    const directLoopIds = new Set(promptInputNodesFor(targetNode).filter(n => n?.type === 'smart-loop' && n.showPrompt).map(n => n.id));
    return inputNodesFor(sourceNode)
        .filter(n => n?.type === 'smart-loop' && n.showPrompt && !directLoopIds.has(n.id));
}
function relayLoopPromptNodesForTarget(node){
    if(!node?.id) return [];
    return inputNodesFor(node).filter(n => n?.type === 'smart-loop' && n.showPrompt);
}
function downstreamNodesForId(nodeId){
    return CanvasGraphRules.downstreamNodesForId(smartGraphHost(), nodeId);
}
function downstreamImageTargetsFor(node){
    return CanvasGraphRules.downstreamImageTargetsFor(smartGraphHost(), node);
}
function downstreamCascadeTargetsFor(node){
    return CanvasGraphRules.downstreamCascadeTargetsFor(smartGraphHost(), node);
}
function directLoopRunTargets(loop){
    return CanvasGraphRules.directLoopRunTargets(smartGraphHost(), loop);
}
function smartCascadeGraphForTail(tail){
    return CanvasGraphRules.smartCascadeGraphForTail(smartGraphHost(), tail);
}
function cascadeTailForLoop(loopId){
    return CanvasGraphRules.cascadeTailForLoop(smartGraphHost(), loopId);
}
function canRunSmartCascade(node){
    return CanvasGraphRules.canRunSmartCascade(smartGraphHost(), node);
}
function isDirectLoopTargetRun(loop, tail, graph){
    return CanvasGraphRules.isDirectLoopTargetRun(smartGraphHost(), loop, tail, graph);
}
function cascadeConnectionKeys(){
    const keys = new Set();
    const addKey = (from, to) => {
        if(from && to) keys.add(`${from}->${to}`);
    };
    const activeLoopIds = new Set(smartCascadeRuns.keys());
    const loops = activeLoopIds.size
        ? nodes.filter(n => n?.type === 'smart-loop' && activeLoopIds.has(n.id))
        : nodes.filter(n => n?.type === 'smart-loop');
    loops.forEach(loop => {
        const tail = cascadeTailForLoop(loop.id);
        if(!tail) return;
        const graph = smartCascadeGraphForTail(tail);
        if(!graph.root) return;
        const chainIds = new Set(graph.path.map(n => n.id));
        graph.edges.forEach(edge => addKey(edge.source.id, edge.target.id));
        (canvas?.connections || []).forEach(conn => {
            if((conn.kind || 'flow') === 'history') return;
            const toNode = nodes.find(n => n.id === conn.to);
            if(conn.from === loop.id && (chainIds.has(conn.to) || downstreamNodesForId(conn.to).some(n => chainIds.has(n.id)))) addKey(conn.from, conn.to);
            if(toNode && chainIds.has(toNode.id)){
                inputNodesFor(toNode).filter(n => n?.type === 'smart-loop' && n.showPrompt).forEach(inputLoop => addKey(inputLoop.id, toNode.id));
            }
        });
    });
    return keys;
}
function coolRunButton(ms=2000){
    return smartDeferredActions.coolRunButton(ms);
}
function coolNodeRunningState(node, ms=2000){
    return smartDeferredActions.coolNodeRunningState(node, ms);
}
function clearNodeRunningState(node){
    return smartDeferredActions.clearNodeRunningState(node);
}
function pushRightSideNodes(sourceNode, delta){
    return SmartOutputCoordination.pushRightSideNodes(smartOutputCoordinationHost(), sourceNode, delta);
}
function cascadeOutputTitle(kind='image', count=1){
    return SmartOutputCoordination.cascadeOutputTitle(smartOutputCoordinationHost(), kind, count);
}
function nonPreviewOutputImages(images=[]){
    return SmartOutputCoordination.nonPreviewOutputImages(smartOutputCoordinationHost(), images);
}
function cleanHistoryImages(images=[]){
    return SmartOutputCoordination.cleanHistoryImages(smartOutputCoordinationHost(), images);
}
function hasHistoryConnection(nodeId, groupId){
    return SmartOutputCoordination.hasHistoryConnection(smartOutputCoordinationHost(), nodeId, groupId);
}
function demoteHistoryGroupNode(group){
    return SmartOutputCoordination.demoteHistoryGroupNode(smartOutputCoordinationHost(), group);
}
function historyGroupForNode(node){
    return SmartOutputCoordination.historyGroupForNode(smartOutputCoordinationHost(), node);
}
function positionHistoryGroupForNode(node, group){
    return SmartOutputCoordination.positionHistoryGroupForNode(smartOutputCoordinationHost(), node, group);
}
function ensureHistoryGroupForNode(node){
    return SmartOutputCoordination.ensureHistoryGroupForNode(smartOutputCoordinationHost(), node);
}
function replaceOutputsToNodeWithHistory(node, additions, kind='image', meta=null, options={}){
    return SmartOutputCoordination.replaceOutputsToNodeWithHistory(smartOutputCoordinationHost(), node, additions, kind, meta, options);
}
function appendOutputsToNode(node, additions, kind='image', options={}){
    return SmartOutputCoordination.appendOutputsToNode(smartOutputCoordinationHost(), node, additions, kind, options);
}
function appendLoopOutputsToNode(node, additions, kind='image', ctx=smartLoopContext){
    return SmartOutputCoordination.appendLoopOutputsToNode(smartOutputCoordinationHost(), node, additions, kind, ctx);
}
function syncCascadeRunButton(node=selectedNode()){
    if(!cascadeRunBtn) return;
    const visible = canRunSmartCascade(node);
    cascadeRunBtn.style.display = visible ? 'inline-flex' : 'none';
    const nodeLoopId = resolveSmartCascadeLoop(node?.id)?.node?.id || '';
    const loopRunState = smartCascadeRunForLoop(nodeLoopId);
    const runningForNode = Boolean(loopRunState);
    cascadeRunBtn.disabled = !visible || (!runningForNode && Boolean(node?.running)) || Boolean(loopRunState?.stopRequested);
    cascadeRunBtn.classList.toggle('is-stop', runningForNode);
    cascadeRunBtn.innerHTML = runningForNode
        ? `<i data-lucide="square"></i><span>${escapeHtml(smartCascadeStopText(Boolean(loopRunState?.stopRequested)))}</span>`
        : `<i data-lucide="workflow"></i><span>${escapeHtml(tr('smart.loopRunAll'))}</span>`;
    refreshIcons();
}
function loadNodePromptDraftToInput(node){
    loadPromptDraft(node);
}
async function createSmartComfyTask(payload){
    return CanvasTaskTransport.createSmartComfyTask({
        fetch:(...args)=>fetch(...args),
        smartResponseErrorMessage:(...args)=>smartResponseErrorMessage(...args),
        tr:(...args)=>tr(...args)
    }, payload);
}
async function waitSmartComfyTaskResult(taskId, binding=null){
    return CanvasTaskTransport.waitSmartComfyTaskResult({
        fetch:(...args)=>fetch(...args),
        resultMediaUrls:(...args)=>resultMediaUrls(...args),
        sleep:(...args)=>sleep(...args),
        smartResponseErrorMessage:(...args)=>smartResponseErrorMessage(...args),
        tr:(...args)=>tr(...args)
    }, taskId, binding);
}
async function runQueuedSmartComfyGenerate(payload, node, options={}){
    return SmartDirectTasks.runQueuedSmartComfyGenerate(smartGenerationHost(), payload, node, options);
}
function comfyParamsFromWorkflowValues(config, values={}){
    return SmartWorkflowParams.comfyParamsFromWorkflowValues(smartWorkflowParamsHost(), config, values);
}
function buildPromptRequestForNode(node, defaultImages, ctx=smartLoopContext){
    return SmartPromptRequest.buildPromptRequestForNode(smartInputHost(), node, defaultImages, ctx);
}
async function waitSmartCanvasTaskBatch(node, taskResult){
    return SmartDirectTasks.waitSmartCanvasTaskBatch(smartGenerationHost(), node, taskResult);
}
async function generateUrlsForCurrentSettings(node, prompt, refs, runSettings=settings, ctx=null){
    return SmartGenerationRunner.generateUrlsForCurrentSettings(smartGenerationHost(), node, prompt, refs, runSettings, ctx);
}
async function generateComfyUrlsWithSettings(runSettings, prompt, refs, node){
    return SmartComfyRunner.generateComfyUrlsWithSettings(smartGenerationHost(), runSettings, prompt, refs, node);
}
async function runCascadeStepIntoNode(sourceNode, targetNode, inputRefs, ctx=smartLoopContext){
    return SmartCascadeSteps.runCascadeStepIntoNode(smartCascadeHost(), sourceNode, targetNode, inputRefs, ctx);
}
async function runLoopRoundIntoSlot(loopNode, rootNode, outputSlot, loopIndex, ctx){
    return SmartCascadeSteps.runLoopRoundIntoSlot(smartCascadeHost(), loopNode, rootNode, outputSlot, loopIndex, ctx);
}
function appendCascadeRefsToReceiver(node, refs, ctx=smartLoopContext){
    return SmartCascadeSteps.appendCascadeRefsToReceiver(smartCascadeHost(), node, refs, ctx);
}
function cascadeRefsFromOutputs(outputs, targetNode){
    return SmartCascadeSteps.cascadeRefsFromOutputs(smartCascadeHost(), outputs, targetNode);
}
function smartCascadeStopText(stopping=false){
    return SmartCascadeState.smartCascadeStopText(smartCascadeHost(), stopping);
}
function smartCascadeAbortError(){
    return SmartCascadeState.smartCascadeAbortError(smartCascadeHost());
}
function throwIfSmartCascadeStopRequested(runState=null){
    return SmartCascadeState.throwIfSmartCascadeStopRequested(smartCascadeHost(), runState);
}
function requestSmartCascadeStop(loopId=''){
    return SmartCascadeState.requestSmartCascadeStop(smartCascadeHost(), loopId);
}
function smartCascadeParallelLimit(chain=[]){
    return SmartCascadeRunner.smartCascadeParallelLimit(smartCascadeHost(), chain);
}
async function runSmartCascadeRoundsWithLimit(roundIndexes, limit, runner, runState=null){
    return SmartCascadeRunner.runSmartCascadeRoundsWithLimit(smartCascadeHost(), roundIndexes, limit, runner, runState);
}
async function runSmartCascade(targetNode=null){
    return SmartCascadeRunner.runSmartCascade(smartCascadeHost(), targetNode);
}
function runSmartCascadeFromLoop(loopId){
    return SmartCascadeRunner.runSmartCascadeFromLoop(smartCascadeHost(), loopId);
}
function smartAssistantExecutionHost(){
    return {
        get CanvasVideoDeconstructionModel(){return CanvasVideoDeconstructionModel;},
        get canvas(){return canvas;},
        get canvasId(){return canvasId;},
        get nodes(){return nodes;},
        get smartCascadeRuns(){return smartCascadeRuns;},
        get smartLoopContext(){return smartLoopContext;},
        buildPromptRequestForNode:(...args)=>buildPromptRequestForNode(...args),
        cloneSmartSettings:(...args)=>cloneSmartSettings(...args),
        createLoopOutputSlot:(...args)=>createLoopOutputSlot(...args),
        createPendingOutputFromSource:(...args)=>createPendingOutputFromSource(...args),
        defaultReferenceImagesFor:(...args)=>defaultReferenceImagesFor(...args),
        nowMs:(...args)=>nowMs(...args),
        outputImagesForNode:(...args)=>outputImagesForNode(...args),
        pushUndo:(...args)=>pushUndo(...args),
        recordSmartTaskSubmission:(...args)=>recordSmartTaskSubmission(...args),
        relayLoopPromptNodesForEdge:(...args)=>relayLoopPromptNodesForEdge(...args),
        rememberRoundOutputs:(...args)=>rememberRoundOutputs(...args),
        rememberSmartAcceptedTasks:(...args)=>rememberSmartAcceptedTasks(...args),
        render:(...args)=>render(...args),
        resumeSmartPendingNode:(...args)=>resumeSmartPendingNode(...args),
        runApiGeneration:(...args)=>runApiGeneration(...args),
        runSmartCascadeRoundsWithLimit:(...args)=>runSmartCascadeRoundsWithLimit(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        saveSmartAcceptedTasksBeforeQuery:(...args)=>saveSmartAcceptedTasksBeforeQuery(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selfReferenceImagesForNode:(...args)=>selfReferenceImagesForNode(...args),
        smartApiAudioMode:(...args)=>smartApiAudioMode(...args),
        smartCascadeIsLoopRunning:(...args)=>smartCascadeIsLoopRunning(...args),
        smartLoopRoundSettings:(...args)=>smartLoopRoundSettings(...args),
        smartNodeInFlight:(...args)=>smartNodeInFlight(...args),
        smartPendingTasks:(...args)=>smartPendingTasks(...args),
        smartSettingsForNode:(...args)=>smartSettingsForNode(...args),
        snapshotRunMeta:(...args)=>snapshotRunMeta(...args),
        stripRunInputMeta:(...args)=>stripRunInputMeta(...args),
        syncSmartCascadeLegacyState:(...args)=>syncSmartCascadeLegacyState(...args),
        throwIfSmartCascadeStopRequested:(...args)=>throwIfSmartCascadeStopRequested(...args)
    };
}
function smartAssistantLoopInputSignature(loop,plan){
    return SmartAssistantExecution.smartAssistantLoopInputSignature(smartAssistantExecutionHost(), loop, plan);
}
function validateSmartAssistantLoopSlots(loop, proposal){
    return SmartAssistantExecution.validateSmartAssistantLoopSlots(smartAssistantExecutionHost(), loop, proposal);
}
function validateSmartLoopPendingOutput(slot, task){
    return SmartAssistantExecution.validateSmartLoopPendingOutput(smartAssistantExecutionHost(), slot, task);
}
async function runSmartAssistantNativeLoop(loop, options){
    return SmartAssistantExecution.runSmartAssistantNativeLoop(smartAssistantExecutionHost(), loop, options);
}
async function runSmartAssistantNativeImage(node, options){
    return SmartAssistantExecution.runSmartAssistantNativeImage(smartAssistantExecutionHost(), node, options);
}
async function runGeneration(options={}){
    return SmartGenerationRunner.runGeneration(smartGenerationHost(), options);
}
async function runPromptLLMNode(nodeId, options={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'smart-prompt') return;
    const upstream = promptNodeLLMInputText(node).trim();
    const instruction = String(node.llmInstruction || '').trim();
    const message = upstream || (instruction ? '请按照处理规则生成结果。' : '');
    const storyOrigin=node.storyAnalysisOrigin || node.shotPromptOrigin;
    const storyResultField=node.shotPromptOrigin ? "shotPromptResult" : "storyAnalysisResult";
    const storySourceText=storyOrigin ? nodes.find(n=>n.id===storyOrigin.sourceNodeId)?.text : undefined;
    if(!message){ toast(tr('smart.promptLlmNeedText')); return; }
    const systemPrompt = [node.llmSystemEnabled ? (node.llmSystemPrompt || '').trim() : '',instruction].filter(Boolean).join('\n\n');
    if(!options.assistantNativeActionId) node.llmEnabled = true;
    node.running = true;
    render();
    try {
        const provider = resolveChatProviderId(node.llmProvider || '');
        const model = resolveChatModel(node.llmModel || '', provider);
        const mediaRefs = promptNodeInputMediaForLLM(node);
        const images = imageRefsOnly(mediaRefs).map(img => img.url).filter(Boolean);
        const videos = videoRefsOnly(mediaRefs).map(video => video.url).filter(Boolean);
        const inputConfig = JSON.stringify([node.llmProvider,node.llmModel,node.llmEnabled,images,videos]);
        if(options.assistantNativeActionId){
            if(!node.llmEnabled || !node.llmProvider || !node.llmModel || provider!==node.llmProvider || model!==node.llmModel){
                const error=new Error('智能提示词的文本模型或 LLM 开关已变化，未提交调用');
                error.submissionKnownRejected=true;throw error;
            }
        }
        if(options.beforeSubmit) await options.beforeSubmit();
        node.llmOutputStale = true;
        if(storyOrigin) delete node[storyResultField];
        const result = await fetch('/api/canvas-llm', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                message,
                messages:[],
                images,
                videos,
                model,
                provider,
                ms_model: provider === 'modelscope' ? model : '',
                system_prompt:systemPrompt
            })
        }).then(async r => {
            if(!r.ok) throw new Error(await r.text());
            return r.json();
        });
        const output = (result.text || '').trim();
        if(!output) throw new Error('LLM 返回空文本，旧结果已保留，请检查后重新运行');
        const currentSystem=[node.llmSystemEnabled ? (node.llmSystemPrompt || '').trim() : '',String(node.llmInstruction || '').trim()].filter(Boolean).join('\n\n');
        const currentMedia=promptNodeInputMediaForLLM(node);
        const currentConfig=JSON.stringify([node.llmProvider,node.llmModel,node.llmEnabled,imageRefsOnly(currentMedia).map(img=>img.url).filter(Boolean),videoRefsOnly(currentMedia).map(video=>video.url).filter(Boolean)]);
        if(promptNodeLLMInputText(node).trim()!==upstream || currentSystem!==systemPrompt || currentConfig!==inputConfig)throw new Error('运行期间规则、模型或上游内容已变化，旧结果已保留，请重新运行');
        node.text = output;
        node.llmOutputStale = false;
        if(storyOrigin) node[storyResultField]={sourceText:storySourceText,outputText:output,provider,model};
        node.llmProvider = provider;
        node.llmModel = model;
        if(options.assistantNativeActionId){
            node.assistantNativeRun.status='succeeded';
            node.assistantNativeRun.outputText=output;
        }
        scheduleSave();
    } catch(e) {
        if(options.assistantNativeActionId){
            node.assistantNativeRun.status='failed';
            node.assistantNativeRun.error=e.message || tr('smart.promptLlmFailed');
            node.assistantNativeRun.knownRejected=!!e.submissionKnownRejected || node.assistantNativeRun.submissionStarted===false;
            scheduleSave();
            throw e;
        }
        scheduleSave();
        toast((e.message || tr('smart.promptLlmFailed')).slice(0, 160));
    } finally {
        node.running = false;
        render();
    }
}
function comfyFieldKind(field){
    return SmartWorkflowParams.comfyFieldKind(smartWorkflowParamsHost(), field);
}
function smartUnknownSubmissionForNode(node){
    if(!node?.id) return null;
    if(node.submissionUnknown) return node;
    const linkedIds = new Set((canvas?.connections || [])
        .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))
        .map(conn => conn.to));
    return nodes.find(item => item?.submissionUnknown
        && (item.sourceNodeId === node.id || linkedIds.has(item.id))) || null;
}
function smartUnknownResubmissionNotice(automatic=false){
    const warning = '上一次请求未收到可靠响应，可能已受理。再次提交可能重复计费。';
    return automatic
        ? `${warning}一键运行已停止；请先核对该节点。`
        : `${warning}请先核对上一次任务。确定再次提交吗？`;
}
function confirmSmartUnknownResubmission(node){
    if(!smartUnknownSubmissionForNode(node)) return true;
    return window.confirm(smartUnknownResubmissionNotice());
}
function smartTaskSubmissionWarning(taskResult){
    return SmartDirectTasks.smartTaskSubmissionWarning(smartGenerationHost(), taskResult);
}
function rememberSmartTaskSubmissionWarning(node, warning, unknown=false){
    return SmartDirectTasks.rememberSmartTaskSubmissionWarning(smartGenerationHost(), node, warning, unknown);
}
function recordSmartTaskSubmission(node, taskResult, runState=null){
    return SmartDirectTasks.recordSmartTaskSubmission(smartGenerationHost(), node, taskResult, runState);
}
async function saveSmartAcceptedTasksBeforeQuery(node, taskIds){
    return SmartDirectTasks.saveSmartAcceptedTasksBeforeQuery(smartGenerationHost(), node, taskIds);
}
function smartGenerationHost(){
    return {
        get API_RATIO_VALUES(){return API_RATIO_VALUES;},
        get CanvasVideoDeconstructionModel(){return CanvasVideoDeconstructionModel;},
        get JimengPendingSignal(){return JimengPendingSignal;},
        get MS_GEN_MODELS(){return MS_GEN_MODELS;},
        get SMART_REFERENCE_IMAGE_MAX(){return SMART_REFERENCE_IMAGE_MAX;},
        get activeSmartComfyTaskPolls(){return activeSmartComfyTaskPolls;},
        get canvas(){return canvas;},
        get comfyWorkflows(){return comfyWorkflows;},
        get nodes(){return nodes;},
        set nodes(value){nodes=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get settings(){return settings;},
        set settings(value){settings=value;},
        get smartClientId(){return smartClientId;},
        get smartLoopContext(){return smartLoopContext;},
        get transientSmartCloudLinks(){return transientSmartCloudLinks;},
        set transientSmartCloudLinks(value){transientSmartCloudLinks=value;},
        get undoSuppressed(){return undoSuppressed;},
        set undoSuppressed(value){undoSuppressed=value;},
        addConnection:(...args)=>addConnection(...args),
        addSmartGenerationLog:(...args)=>addSmartGenerationLog(...args),
        apiImageSize:(...args)=>apiImageSize(...args),
        applyUploadedUrlsToSmartRefs:(...args)=>applyUploadedUrlsToSmartRefs(...args),
        attachRunMeta:(...args)=>attachRunMeta(...args),
        audioRefsOnly:(...args)=>audioRefsOnly(...args),
        buildPromptRequest:(...args)=>buildPromptRequest(...args),
        buildPromptRequestForNode:(...args)=>buildPromptRequestForNode(...args),
        clearNodeRunningState:(...args)=>clearNodeRunningState(...args),
        clearPromptInput:(...args)=>clearPromptInput(...args),
        get clearSmartUnsavedAcceptedTasks(){return typeof clearSmartUnsavedAcceptedTasks==='function' ? (...args)=>clearSmartUnsavedAcceptedTasks(...args) : undefined;},
        cloneSmartSettings:(...args)=>cloneSmartSettings(...args),
        comfyFieldKind:(...args)=>comfyFieldKind(...args),
        comfyNameForRef:(...args)=>comfyNameForRef(...args),
        comfyParamsFromWorkflowValues:(...args)=>comfyParamsFromWorkflowValues(...args),
        comfyRandomEnabledField:(...args)=>comfyRandomEnabledField(...args),
        confirmSmartUnknownResubmission:(...args)=>confirmSmartUnknownResubmission(...args),
        coolNodeRunningState:(...args)=>coolNodeRunningState(...args),
        createNode:(...args)=>createNode(...args),
        createPendingOutputFromSource:(...args)=>createPendingOutputFromSource(...args),
        createSmartComfyTask:(...args)=>createSmartComfyTask(...args),
        escapeHtml:(...args)=>escapeHtml(...args),
        fetch:(...args)=>fetch(...args),
        finalizePendingNode:(...args)=>finalizePendingNode(...args),
        finalizeSmartPendingTask:(...args)=>finalizeSmartPendingTask(...args),
        generateComfyUrlsWithSettings:(...args)=>generateComfyUrlsWithSettings(...args),
        handleJimengPendingSignal:(...args)=>handleJimengPendingSignal(...args),
        imageRefsOnly:(...args)=>imageRefsOnly(...args),
        imagesForNode:(...args)=>imagesForNode(...args),
        isApiLikeEngine:(...args)=>isApiLikeEngine(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        isSmartImageNode:(...args)=>isSmartImageNode(...args),
        mediaKindForUrls:(...args)=>mediaKindForUrls(...args),
        modelscopeImageModels:(...args)=>modelscopeImageModels(...args),
        nodeRect:(...args)=>nodeRect(...args),
        nowMs:(...args)=>nowMs(...args),
        parseSizeValue:(...args)=>parseSizeValue(...args),
        pendingBoxSize:(...args)=>pendingBoxSize(...args),
        pollSmartCanvasTask:(...args)=>pollSmartCanvasTask(...args),
        pollSmartVideoCanvasTask:(...args)=>pollSmartVideoCanvasTask(...args),
        prepareSmartVideoTask:(...args)=>prepareSmartVideoTask(...args),
        providerChatModels:(...args)=>providerChatModels(...args),
        pushUndo:(...args)=>pushUndo(...args),
        recordSmartTaskSubmission:(...args)=>recordSmartTaskSubmission(...args),
        rememberRecentSmartSettings:(...args)=>rememberRecentSmartSettings(...args),
        get rememberSmartAcceptedTasks(){return typeof rememberSmartAcceptedTasks==='function' ? (...args)=>rememberSmartAcceptedTasks(...args) : undefined;},
        rememberSmartTaskSubmissionWarning:(...args)=>rememberSmartTaskSubmissionWarning(...args),
        render:(...args)=>render(...args),
        restoreFromExtraction:(...args)=>restoreFromExtraction(...args),
        restoreSourceVisualState:(...args)=>restoreSourceVisualState(...args),
        resultMediaUrls:(...args)=>resultMediaUrls(...args),
        resumeSmartPendingNode:(...args)=>resumeSmartPendingNode(...args),
        get retainSmartVideoTaskRecovery(){return typeof retainSmartVideoTaskRecovery==='function' ? (...args)=>retainSmartVideoTaskRecovery(...args) : undefined;},
        rhActiveFields:(...args)=>rhActiveFields(...args),
        rhBuildNodeInfoList:(...args)=>rhBuildNodeInfoList(...args),
        rhBuildWorkflowRequestExtras:(...args)=>rhBuildWorkflowRequestExtras(...args),
        rhMediaForRun:(...args)=>rhMediaForRun(...args),
        runApiGeneration:(...args)=>runApiGeneration(...args),
        runApiVideoGeneration:(...args)=>runApiVideoGeneration(...args),
        runComfyGeneration:(...args)=>runComfyGeneration(...args),
        runModelscopeGeneration:(...args)=>runModelscopeGeneration(...args),
        runQueuedSmartComfyGenerate:(...args)=>runQueuedSmartComfyGenerate(...args),
        runRunningHubGeneration:(...args)=>runRunningHubGeneration(...args),
        runSmartApiAudio:(...args)=>runSmartApiAudio(...args),
        runSmartAssistantNativeImage:(...args)=>runSmartAssistantNativeImage(...args),
        runningHubModelApiSettings:(...args)=>runningHubModelApiSettings(...args),
        runningHubSelectedModel:(...args)=>runningHubSelectedModel(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        saveSmartAcceptedTasksBeforeQuery:(...args)=>saveSmartAcceptedTasksBeforeQuery(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        selectedNode:(...args)=>selectedNode(...args),
        selectedRunningHubRef:(...args)=>selectedRunningHubRef(...args),
        sizeForRun:(...args)=>sizeForRun(...args),
        sleep:(...args)=>sleep(...args),
        smartApiAudioMode:(...args)=>smartApiAudioMode(...args),
        smartComfyRandomActive:(...args)=>smartComfyRandomActive(...args),
        smartComfyRandomActiveFor:(...args)=>smartComfyRandomActiveFor(...args),
        smartComfyRandomValue:(...args)=>smartComfyRandomValue(...args),
        smartImageUsesWorkflowInput:(...args)=>smartImageUsesWorkflowInput(...args),
        smartNodeInFlight:(...args)=>smartNodeInFlight(...args),
        get smartPendingTasks(){return typeof smartPendingTasks==='function' ? (...args)=>smartPendingTasks(...args) : undefined;},
        smartRecoverableImageTask:(...args)=>smartRecoverableImageTask(...args),
        smartResponseErrorMessage:(...args)=>smartResponseErrorMessage(...args),
        smartRunNeedsPrompt:(...args)=>smartRunNeedsPrompt(...args),
        smartRunSnapshot:(...args)=>smartRunSnapshot(...args),
        smartSettingsForNode:(...args)=>smartSettingsForNode(...args),
        snapshotRunMeta:(...args)=>snapshotRunMeta(...args),
        stripRunInputMeta:(...args)=>stripRunInputMeta(...args),
        syncRunButtonState:(...args)=>syncRunButtonState(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        urlToBase64:(...args)=>urlToBase64(...args),
        videoProviderPlatform:(...args)=>videoProviderPlatform(...args),
        videoRefsOnly:(...args)=>videoRefsOnly(...args),
        waitSmartCanvasTaskBatch:(...args)=>waitSmartCanvasTaskBatch(...args),
        waitSmartComfyTaskResult:(...args)=>waitSmartComfyTaskResult(...args)
    };
}
async function runApiGeneration(prompt, refs, runSettings=settings, options={}){
    return SmartApiRunner.runApiGeneration(smartGenerationHost(), prompt, refs, runSettings, options);
}
function smartCompactJson(value, max=4200){
    return SmartProviderRunner.smartCompactJson(smartGenerationHost(), value, max);
}
function smartDetailedError(message, details={}){
    return SmartProviderRunner.smartDetailedError(smartGenerationHost(), message, details);
}
function runningHubPayloadError(stage, data, fallback, extra={}){
    return SmartProviderRunner.runningHubPayloadError(smartGenerationHost(), stage, data, fallback, extra);
}
async function runRunningHubGeneration(prompt, refs, runSettings=settings){
    return SmartProviderRunner.runRunningHubGeneration(smartGenerationHost(), prompt, refs, runSettings);
}
function restoreSmartVideoSubmissionWarning(node, previous){
    return SmartApiRunner.restoreSmartVideoSubmissionWarning(smartGenerationHost(), node, previous);
}
async function markSmartVideoSubmissionBeforeRequest(node){
    return SmartApiRunner.markSmartVideoSubmissionBeforeRequest(smartGenerationHost(), node);
}
async function runApiVideoGeneration(prompt, refs, runSettings=settings, node, runState=null){
    return SmartApiRunner.runApiVideoGeneration(smartGenerationHost(), prompt, refs, runSettings, node, runState);
}
async function runModelscopeGeneration(prompt, refs, runSettings=settings){
    return SmartProviderRunner.runModelscopeGeneration(smartGenerationHost(), prompt, refs, runSettings);
}
async function urlToBase64(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error(tr('smart.errImageRead'));
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
async function runComfyGeneration(node, prompt, refs, pendingNode, meta){
    return SmartComfyRunner.runComfyGeneration(smartGenerationHost(), node, prompt, refs, pendingNode, meta);
}
async function runComfyText(node, prompt, pendingNode, meta){
    return SmartComfyRunner.runComfyText(smartGenerationHost(), node, prompt, pendingNode, meta);
}
async function runComfyEnhance(node, refs, pendingNode, meta){
    return SmartComfyRunner.runComfyEnhance(smartGenerationHost(), node, refs, pendingNode, meta);
}
async function runComfyEdit(node, prompt, refs, pendingNode, meta){
    return SmartComfyRunner.runComfyEdit(smartGenerationHost(), node, prompt, refs, pendingNode, meta);
}
async function comfyNameForRef(ref){
    const localRef = String(ref?.url || '').startsWith('/assets/');
    if(ref.comfy_name && !localRef) return ref.comfy_name;
    const response = await fetch(ref.url);
    if(!response.ok) throw new Error(`无法读取参考素材「${ref.name || ref.url}」（HTTP ${response.status}）`);
    const blob = await response.blob();
    const form = new FormData();
    form.append('files', blob, ref.name || 'smart-ref.png');
    const data = await fetch('/api/upload', {method:'POST', body:form}).then(async r => {
        if(!r.ok) throw new Error(await r.text());
        return r.json();
    });
    const name = String(data.files?.[0]?.comfy_name || '').trim();
    if(!name) throw new Error(`参考素材「${ref.name || ref.url}」上传到 ComfyUI 失败`);
    const node = ref.nodeId ? nodes.find(n => n.id === ref.nodeId) : null;
    const image = node?.images?.find(img => img.url === ref.url) || (nodes || []).flatMap(n => n.images || []).find(img => img?.url === ref.url);
    if(image) image.comfy_name = name;
    ref.comfy_name = name;
    return name;
}


















function smartTaskRecoveryControlHost(){
    return {
        get CanvasTaskTransport(){return CanvasTaskTransport;},
        get ImageTaskRecoverSignal(){return ImageTaskRecoverSignal;},
        get JIMENG_POLL_INTERVAL(){return JIMENG_POLL_INTERVAL;},
        get JIMENG_POLL_MAX(){return JIMENG_POLL_MAX;},
        get JimengPendingSignal(){return JimengPendingSignal;},
        get activeJimengPolls(){return activeJimengPolls;},
        get activeSmartTaskPolls(){return activeSmartTaskPolls;},
        get nodes(){return nodes;},
        get settings(){return settings;},
        get clearSmartUnsavedAcceptedTasks(){return typeof clearSmartUnsavedAcceptedTasks==='function' ? (...args)=>clearSmartUnsavedAcceptedTasks(...args) : undefined;},
        copyMediaSizeFields:(...args)=>copyMediaSizeFields(...args),
        fetch:(...args)=>fetch(...args),
        finalizeSmartPendingTask:(...args)=>finalizeSmartPendingTask(...args),
        nowMs:(...args)=>nowMs(...args),
        render:(...args)=>render(...args),
        replaceOutputsToNodeWithHistory:(...args)=>replaceOutputsToNodeWithHistory(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        resultMediaUrls:(...args)=>resultMediaUrls(...args),
        resumeSmartPendingNode:(...args)=>resumeSmartPendingNode(...args),
        saveCanvas:(...args)=>saveCanvas(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartRecoverableImageTask:(...args)=>smartRecoverableImageTask(...args),
        stripImageGenerationMeta:(...args)=>stripImageGenerationMeta(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        uid:(...args)=>uid(...args)
    };
}
function smartPendingTasks(node){
    return SmartTaskRecoveryControl.smartPendingTasks(smartTaskRecoveryControlHost(), node);
}
function smartAcceptedTaskRecoveryHost(){
    return {
        get SMART_UNSAVED_ACCEPTED_TASKS_PREFIX(){return SMART_UNSAVED_ACCEPTED_TASKS_PREFIX;},
        get canvasId(){return typeof canvasId==='undefined'?undefined:canvasId;},
        get storage(){return typeof localStorage==='undefined'?undefined:localStorage;},
        nowMs:(...args)=>nowMs(...args),
        get nodes(){return nodes;},
        render:(...args)=>render(...args),
        smartPendingTasks:(...args)=>smartPendingTasks(...args)
    };
}
function smartUnsavedAcceptedTasksKey(id){
    return CanvasAcceptedTaskRecovery.smartUnsavedAcceptedTasksKey(smartAcceptedTaskRecoveryHost(), id);
}
function readSmartUnsavedAcceptedTasks(id){
    return CanvasAcceptedTaskRecovery.readSmartUnsavedAcceptedTasks(smartAcceptedTaskRecoveryHost(), id);
}
function rememberSmartAcceptedTasks(node, tasks=[], ownerCanvasId){
    return CanvasAcceptedTaskRecovery.rememberSmartAcceptedTasks(smartAcceptedTaskRecoveryHost(), node, tasks, ownerCanvasId);
}
function clearSmartUnsavedAcceptedTasks(taskIds=[]){
    return CanvasAcceptedTaskRecovery.clearSmartUnsavedAcceptedTasks(smartAcceptedTaskRecoveryHost(), taskIds);
}
function restoreSmartUnsavedAcceptedTasks(){
    return CanvasAcceptedTaskRecovery.restoreSmartUnsavedAcceptedTasks(smartAcceptedTaskRecoveryHost());
}
class JimengPendingSignal extends Error {
    constructor(info){
        const data = info || {};
        super(data.message || '即梦任务排队中，可继续等待或手动查询');
        this.jimengPending = true;
        this.submitId = data.submitId || data.submit_id || '';
        this.kind = data.kind || 'image';
        this.queueInfo = data.queueInfo || data.queue_info || {};
    }
}
class ImageTaskRecoverSignal extends Error {
    constructor(info){
        const data = info || {};
        super(data.message || '任务未丢失，可稍后手动查询结果');
        this.imageTaskRecover = true;
        this.taskId = data.taskId || data.task_id || '';
        this.recoverTaskId = data.recoverTaskId || data.upstream_task_id || data.task_id || '';
        this.providerId = data.providerId || data.provider_id || '';
        this.kind = data.kind || 'image';
    }
}
function extractUpstreamTaskId(text){
    return SmartTaskRecoveryControl.extractUpstreamTaskId(smartTaskRecoveryControlHost(), text);
}
const activeJimengPolls = new Set();
const JIMENG_POLL_INTERVAL = 60000;
const JIMENG_POLL_MAX = 1440;
function jimengQueueText(queueInfo){
    return SmartTaskRecoveryControl.jimengQueueText(smartTaskRecoveryControlHost(), queueInfo);
}
function setNodeJimengPending(node, signal){
    return SmartTaskRecoveryControl.setNodeJimengPending(smartTaskRecoveryControlHost(), node, signal);
}
function handleJimengPendingSignal(node, e){
    return SmartTaskRecoveryControl.handleJimengPendingSignal(smartTaskRecoveryControlHost(), node, e);
}
function finalizeJimengPending(node, urls, kind='image'){
    return SmartTaskRecoveryControl.finalizeJimengPending(smartTaskRecoveryControlHost(), node, urls, kind);
}
function applyJimengQueryResult(node, data){
    return SmartTaskRecoveryControl.applyJimengQueryResult(smartTaskRecoveryControlHost(), node, data);
}
async function fetchJimengQuery(submitId, kind){
    return SmartTaskRecoveryControl.fetchJimengQuery(smartTaskRecoveryControlHost(), submitId, kind);
}
async function queryJimengNow(nodeId){
    return SmartTaskRecoveryControl.queryJimengNow(smartTaskRecoveryControlHost(), nodeId);
}
function providerIdForSmartTask(node, task){
    return SmartTaskRecoveryControl.providerIdForSmartTask(smartTaskRecoveryControlHost(), node, task);
}
async function fetchImageTaskQuery(providerId, taskId){
    return SmartTaskRecoveryControl.fetchImageTaskQuery(smartTaskRecoveryControlHost(), providerId, taskId);
}
async function querySmartImageTaskNow(nodeId, localTaskId){
    return SmartTaskRecoveryControl.querySmartImageTaskNow(smartTaskRecoveryControlHost(), nodeId, localTaskId);
}
function startJimengPoll(node){
    return SmartTaskRecoveryControl.startJimengPoll(smartTaskRecoveryControlHost(), node);
}
function resumeJimengPendingNodes(){
    return SmartTaskRecoveryControl.resumeJimengPendingNodes(smartTaskRecoveryControlHost());
}
async function pollSmartCanvasTask(taskId, binding=null){
    return SmartTaskRecoveryControl.pollSmartCanvasTask(smartTaskRecoveryControlHost(), taskId, binding);
}
function prepareSmartVideoTask(node){
    return SmartTaskRecoveryControl.prepareSmartVideoTask(smartTaskRecoveryControlHost(), node);
}
function retainSmartVideoTaskRecovery(node, error){
    return SmartTaskRecoveryControl.retainSmartVideoTaskRecovery(smartTaskRecoveryControlHost(), node, error);
}
async function refreshSmartVideoCanvasTaskOnce(taskId){
    return CanvasTaskTransport.refreshSmartVideoCanvasTaskOnce({
        fetch:(...args)=>fetch(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args)
    }, taskId);
}
async function pollSmartVideoCanvasTask(taskId, options={}){
    return CanvasTaskTransport.pollSmartVideoCanvasTask({
        fetch:(...args)=>fetch(...args),
        responseErrorMessage:(...args)=>responseErrorMessage(...args),
        setTimeout:(...args)=>setTimeout(...args)
    }, taskId, options);
}
function smartTaskRuntimeHost(){
    return {
        finalizeSmartPendingTask:(...args)=>finalizeSmartPendingTask(...args),
        validateSmartGroupPendingOutput:(...args)=>validateSmartGroupPendingOutput(...args),
        get MEDIA_GROUP_DEFAULT_SCALE(){return MEDIA_GROUP_DEFAULT_SCALE;},
        get MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE(){return MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE;},
        get MEDIA_NODE_DEFAULT_SCALE(){return MEDIA_NODE_DEFAULT_SCALE;},
        get activeSmartComfyTaskPolls(){return activeSmartComfyTaskPolls;},
        get canvas(){return canvas;},
        get canvasId(){return canvasId;},
        get nodes(){return nodes;},
        addSmartGenerationLog:(...args)=>addSmartGenerationLog(...args),
        cleanHistoryImages:(...args)=>cleanHistoryImages(...args),
        copyMediaSizeFields:(...args)=>copyMediaSizeFields(...args),
        mediaKindForUrls:(...args)=>mediaKindForUrls(...args),
        mediaNodeDefaultScale:(...args)=>mediaNodeDefaultScale(...args),
        nowMs:(...args)=>nowMs(...args),
        pollSmartCanvasTask:(...args)=>pollSmartCanvasTask(...args),
        pollSmartVideoCanvasTask:(...args)=>pollSmartVideoCanvasTask(...args),
        providerIdForSmartTask:(...args)=>providerIdForSmartTask(...args),
        render:(...args)=>render(...args),
        resultMediaUrls:(...args)=>resultMediaUrls(...args),
        resumeSmartDepthCaptureTasks:(...args)=>resumeSmartDepthCaptureTasks(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        setNodeJimengPending:(...args)=>setNodeJimengPending(...args),
        smartPendingTasks:(...args)=>smartPendingTasks(...args),
        smartRecoverableImageTask:(...args)=>smartRecoverableImageTask(...args),
        stripImageGenerationMeta:(...args)=>stripImageGenerationMeta(...args),
        toast:(...args)=>toast(...args),
        tr:(...args)=>tr(...args),
        validateSmartLoopPendingOutput:(...args)=>validateSmartLoopPendingOutput(...args),
        waitSmartComfyTaskResult:(...args)=>waitSmartComfyTaskResult(...args)
    };
}
function finalizeSmartPendingTask(node, taskId, images, kind='image'){
    return CanvasTaskResults.finalizeSmartPendingTask(smartTaskRuntimeHost(), node, taskId, images, kind);
}
function validateSmartGroupPendingOutput(node, task){
    return CanvasTaskResults.validateSmartGroupPendingOutput(smartTaskRuntimeHost(), node, task);
}
async function resumeSmartPendingNode(node, logContext={}, onlyTaskId=''){
    return CanvasTaskRuntime.resumeSmartPendingNode(smartTaskRuntimeHost(), node, logContext, onlyTaskId);
}
function resumeSmartPendingTasks(){
    return CanvasTaskRuntime.resumeSmartPendingTasks(smartTaskRuntimeHost());
}
function updateSelectionBox(event){
    return SmartSelection.updateSelectionBox(smartLayoutHost(), event);
}
function finishSelection(event){
    return SmartSelection.finishSelection(smartLayoutHost(), event);
}
function groupSelectedNodes(){
    return SmartGroupEdit.groupSelectedNodes(smartNodeEditHost());
}
function ungroupNode(groupId){
    return SmartGroupEdit.ungroupNode(smartNodeEditHost(), groupId);
}
function mergeImageNodesIntoGroup(sourceId, targetId){
    const source = nodes.find(n => n.id === sourceId);
    const target = nodes.find(n => n.id === targetId);
    if(!source || !target || source.id === target.id) return false;
    if(!(source.images || []).length || !(target.images || []).length) return false;
    const sourceImages = (source.images || []).map(img => stripImageGenerationMeta({...img}));
    target.images = [...(target.images || []).map(img => stripImageGenerationMeta(img)), ...sourceImages];
    target.title = 'Group';
    if(!Number.isFinite(Number(target.scale)) || Number(target.scale) === MEDIA_NODE_DEFAULT_SCALE) target.scale = MEDIA_GROUP_DEFAULT_SCALE;
    delete target.w;
    delete target.h;
    canvas.connections = (canvas.connections || []).map(c => {
        if(c.from === source.id) return {...c, from:target.id};
        if(c.to === source.id) return {...c, to:target.id};
        return c;
    }).filter((c, index, arr) => c.from !== c.to && arr.findIndex(x => x.from === c.from && x.to === c.to && (x.kind || 'flow') === (c.kind || 'flow')) === index);
    nodes.forEach(node => {
        if(Array.isArray(node.inputNodeIds)){
            node.inputNodeIds = Array.from(new Set(node.inputNodeIds.map(id => id === source.id ? target.id : id).filter(id => id !== node.id)));
        }
    });
    nodes = nodes.filter(n => n.id !== source.id);
    selectedIds = [];
    selectedId = target.id;
    selectedImage = {nodeId:'', index:-1};
    return true;
}
function smartGroupTargetForDraggedNode(draggedNode){
    // 允许把一个分组拖进另一个分组（拖来的分组的成员会作为输入并入目标分组）。自身/被拖分组及其成员已在 excluded 中排除。
    if(!draggedNode) return null;
    const r = nodeRect(draggedNode);
    const excluded = new Set([draggedNode.id, ...(dragState?.groupIds || [])]);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const groups = nodes
        .filter(node => isSmartGroupNode(node) && !excluded.has(node.id))
        .map(group => ({group, rect:nodeRect(group)}))
        .filter(item => cx >= item.rect.x && cx <= item.rect.x + item.rect.width && cy >= item.rect.y && cy <= item.rect.y + item.rect.height);
    if(!groups.length) return null;
    groups.sort((a, b) => (nodes.indexOf(b.group) - nodes.indexOf(a.group)));
    return groups[0].group;
}
function addDraggedNodeToSmartGroup(draggedNode, group){
    return SmartGroupEdit.addDraggedNodeToSmartGroup(smartNodeEditHost(), draggedNode, group);
}
// 把一个或多个被拖动的节点批量加入目标分组（支持多选拖入）。入组后只整理一次并选中目标分组。
function addDraggedNodesToSmartGroup(draggedNodes, group){
    return SmartGroupEdit.addDraggedNodesToSmartGroup(smartNodeEditHost(), draggedNodes, group);
}
function smartCreateMenuHost(){
    return {
        get createMenu(){return createMenu;},
        get createMenuGroupId(){return createMenuGroupId;},
        set createMenuGroupId(value){createMenuGroupId=value;},
        get createMenuPoint(){return createMenuPoint;},
        set createMenuPoint(value){createMenuPoint=value;},
        get window(){return window;},
        createNodeFromMenu:(...args)=>createNodeFromMenu(...args),
        refreshIcons:(...args)=>refreshIcons(...args),
        screenToWorld:(...args)=>screenToWorld(...args)
    };
}
function closeCreateMenu(){
    return SmartCreateMenu.closeCreateMenu(smartCreateMenuHost());
}
function openCreateMenu(event, options={}){
    return SmartCreateMenu.openCreateMenu(smartCreateMenuHost(), event, options);
}
function addCreatedNodeToMenuGroup(node){
    return SmartGroupEdit.addCreatedNodeToMenuGroup(smartNodeEditHost(), node);
}
function createNodeFromMenu(type){
    return SmartNodeEdit.createNodeFromMenu(smartNodeEditHost(), type);
}
shell.addEventListener('mousedown', e => {
    if(!zoomPreviewState) return;
    if(e.button !== 0) return;
    if(e.target.closest('.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.smart-minimap')) return;
    e.preventDefault();
    e.stopPropagation();
}, true);
shell.addEventListener('click', e => {
    if(!zoomPreviewState) return;
    if(e.button !== 0) return;
    if(e.target.closest('.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.smart-minimap')) return;
    e.preventDefault();
    e.stopPropagation();
    const nodeEl = e.target.closest('.image-node');
    if(nodeEl?.dataset?.id) exitZoomPreviewToNode(nodeEl.dataset.id);
    else exitZoomPreview(screenToWorld(e));
}, true);
function smartPointerHost(){
    return {
        handleImageEditorPointerMove:(...args)=>smartImageEditorEvents.pointerMove(...args),
        handleImageEditorPointerUp:(...args)=>smartImageEditorEvents.pointerUp(...args),
        get CSS(){return CSS;},
        get PROMPT_LLM_INSTRUCTION_MAX_H(){return PROMPT_LLM_INSTRUCTION_MAX_H;},
        get PROMPT_LLM_INSTRUCTION_MIN_H(){return PROMPT_LLM_INSTRUCTION_MIN_H;},
        get PROMPT_SPLIT_PREVIEW_MAX_H(){return PROMPT_SPLIT_PREVIEW_MAX_H;},
        get PROMPT_SPLIT_PREVIEW_MIN_H(){return PROMPT_SPLIT_PREVIEW_MIN_H;},
        get SMART_GROUP_MAX_MEMBER_ZOOM(){return SMART_GROUP_MAX_MEMBER_ZOOM;},
        get SMART_GROUP_MIN_HEIGHT(){return SMART_GROUP_MIN_HEIGHT;},
        get SMART_GROUP_MIN_WIDTH(){return SMART_GROUP_MIN_WIDTH;},
        get assetLibraryOpen(){return assetLibraryOpen;},
        get assetPanel(){return assetPanel;},
        get connectionEraseState(){return connectionEraseState;},
        set connectionEraseState(value){connectionEraseState=value;},
        get didPan(){return didPan;},
        set didPan(value){didPan=value;},
        get document(){return document;},
        get dragState(){return dragState;},
        set dragState(value){dragState=value;},
        get isRKeyDown(){return isRKeyDown;},
        get lastMouseWorld(){return lastMouseWorld;},
        set lastMouseWorld(value){lastMouseWorld=value;},
        get llmInstructionResizeState(){return llmInstructionResizeState;},
        set llmInstructionResizeState(value){llmInstructionResizeState=value;},
        get loopInsertPreview(){return loopInsertPreview;},
        set loopInsertPreview(value){loopInsertPreview=value;},
        get nodes(){return nodes;},
        get panState(){return panState;},
        set panState(value){panState=value;},
        get portDragState(){return portDragState;},
        set portDragState(value){portDragState=value;},
        get promptInput(){return promptInput;},
        get promptResizeState(){return promptResizeState;},
        set promptResizeState(value){promptResizeState=value;},
        get promptSplitResizeState(){return promptSplitResizeState;},
        set promptSplitResizeState(value){promptSplitResizeState=value;},
        get resizeState(){return resizeState;},
        set resizeState(value){resizeState=value;},
        get selectedId(){return selectedId;},
        set selectedId(value){selectedId=value;},
        get selectedIds(){return selectedIds;},
        set selectedIds(value){selectedIds=value;},
        get selectedImage(){return selectedImage;},
        set selectedImage(value){selectedImage=value;},
        get selectionJustFinished(){return selectionJustFinished;},
        get selectionState(){return selectionState;},
        set selectionState(value){selectionState=value;},
        get settings(){return settings;},
        get shell(){return shell;},
        get smartMinimapDrag(){return smartMinimapDrag;},
        set smartMinimapDrag(value){smartMinimapDrag=value;},
        get suppressNodeClickUntil(){return suppressNodeClickUntil;},
        set suppressNodeClickUntil(value){suppressNodeClickUntil=value;},
        get thumbDragState(){return thumbDragState;},
        set thumbDragState(value){thumbDragState=value;},
        get undoSuppressed(){return undoSuppressed;},
        set undoSuppressed(value){undoSuppressed=value;},
        get viewport(){return viewport;},
        get world(){return world;},
        get zoomPreviewState(){return zoomPreviewState;},
        addDraggedNodesToSmartGroup:(...args)=>addDraggedNodesToSmartGroup(...args),
        addUrlToAssetLibrary:(...args)=>addUrlToAssetLibrary(...args),
        applyNodeMetaToImage:(...args)=>applyNodeMetaToImage(...args),
        applyViewport:(...args)=>applyViewport(...args),
        arrangeSmartGroupMembers:(...args)=>arrangeSmartGroupMembers(...args),
        canAutoConnectDraggedNode:(...args)=>canAutoConnectDraggedNode(...args),
        centerViewportOnWorldPoint:(...args)=>centerViewportOnWorldPoint(...args),
        clearConnectionEraseTrail:(...args)=>clearConnectionEraseTrail(...args),
        clearDropHighlight:(...args)=>clearDropHighlight(...args),
        clearPortDragVisual:(...args)=>clearPortDragVisual(...args),
        clearSelection:(...args)=>clearSelection(...args),
        closeCreateMenu:(...args)=>closeCreateMenu(...args),
        commitPendingUndo:(...args)=>commitPendingUndo(...args),
        connectInputNode:(...args)=>connectInputNode(...args),
        createImageNodeAt:(...args)=>createImageNodeAt(...args),
        discardPendingUndo:(...args)=>discardPendingUndo(...args),
        dragConnectTargetFor:(...args)=>dragConnectTargetFor(...args),
        eraseConnectionsAlongPointer:(...args)=>eraseConnectionsAlongPointer(...args),
        eraseConnectionsAtPoint:(...args)=>eraseConnectionsAtPoint(...args),
        finishConnectionErase:(...args)=>finishConnectionErase(...args),
        finishSelection:(...args)=>finishSelection(...args),
        handlePortDrop:(...args)=>handlePortDrop(...args),
        inheritNodeMetaFromImage:(...args)=>inheritNodeMetaFromImage(...args),
        insertLoopNodeIntoConnection:(...args)=>insertLoopNodeIntoConnection(...args),
        insertionConnectionForNode:(...args)=>insertionConnectionForNode(...args),
        isSmartGroupNode:(...args)=>isSmartGroupNode(...args),
        mergeImageNodesIntoGroup:(...args)=>mergeImageNodesIntoGroup(...args),
        minimapEventToWorld:(...args)=>minimapEventToWorld(...args),
        moveNodeElementsDuringDrag:(...args)=>moveNodeElementsDuringDrag(...args),
        nodeRect:(...args)=>nodeRect(...args),
        openCreateMenu:(...args)=>openCreateMenu(...args),
        persistActiveSmartSettings:(...args)=>persistActiveSmartSettings(...args),
        promptLlmInstructionHeight:(...args)=>promptLlmInstructionHeight(...args),
        promptNodeExpandedHeight:(...args)=>promptNodeExpandedHeight(...args),
        promptNodeMinHeight:(...args)=>promptNodeMinHeight(...args),
        promptNodeSplitPreviewHeight:(...args)=>promptNodeSplitPreviewHeight(...args),
        pruneSmartGroupMembershipsForNode:(...args)=>pruneSmartGroupMembershipsForNode(...args),
        rectOverlapNode:(...args)=>rectOverlapNode(...args),
        render:(...args)=>render(...args),
        restoreDraggedNodePosition:(...args)=>restoreDraggedNodePosition(...args),
        scheduleConnectionLayerRefresh:(...args)=>scheduleConnectionLayerRefresh(...args),
        scheduleSave:(...args)=>scheduleSave(...args),
        screenToWorld:(...args)=>screenToWorld(...args),
        setAssetDragOver:(...args)=>setAssetDragOver(...args),
        setDropHighlight:(...args)=>setDropHighlight(...args),
        setTimeout:(...args)=>setTimeout(...args),
        smartGroupCompactMembers:(...args)=>smartGroupCompactMembers(...args),
        smartGroupImageRefs:(...args)=>smartGroupImageRefs(...args),
        smartGroupTargetForDraggedNode:(...args)=>smartGroupTargetForDraggedNode(...args),
        updateConnectionEraseTrail:(...args)=>updateConnectionEraseTrail(...args),
        updateLoopInsertPreview:(...args)=>updateLoopInsertPreview(...args),
        updateNodeElementDuringResize:(...args)=>updateNodeElementDuringResize(...args),
        updatePortDragVisual:(...args)=>updatePortDragVisual(...args),
        updateSelectionBox:(...args)=>updateSelectionBox(...args)
    };
}

shell.onmousedown = e => { return SmartPointerEvents.pointerDown(smartPointerHost(), e); };

shell.oncontextmenu = e => { return SmartPointerEvents.contextMenu(smartPointerHost(), e); };

shell.ondblclick = e => { return SmartPointerEvents.doubleClick(smartPointerHost(), e); };

shell.onclick = e => { return SmartPointerEvents.backgroundClick(smartPointerHost(), e); };
minimap?.addEventListener('mousedown', e => {
    if(e.button !== 0) return;
    if(e.target.closest?.('#smartArrangeBtn')) return;
    e.preventDefault();
    e.stopPropagation();
    smartMinimapDrag = true;
    centerViewportOnWorldPoint(minimapEventToWorld(e));
});
smartArrangeBtn?.addEventListener('mousedown', e => e.stopPropagation());
smartArrangeBtn?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    arrangeSelectedSmartNodes();
});

window.onmousemove = e => { return SmartPointerEvents.pointerMove(smartPointerHost(), e); };

window.onmouseup = e => { return SmartPointerEvents.pointerUp(smartPointerHost(), e); };
shell.addEventListener('wheel', e => {
    if(e.target.closest('.composer,.smart-back,.image-edit-modal,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.workflow-transfer-panel,.log-modal,.shortcut-modal,.prompt-node-segments,.prompt-node-text,.prompt-node-llm,.smart-group-list,[data-thumb-scroll]')) return;
    e.preventDefault();
    const rect = shell.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = {x:(sx - viewport.x) / viewport.scale, y:(sy - viewport.y) / viewport.scale};
    const factor = Math.exp(-e.deltaY * 0.001);
    viewport.scale = safeScale(viewport.scale * factor);
    viewport.x = sx - before.x * viewport.scale;
    viewport.y = sy - before.y * viewport.scale;
    applyViewport();
    scheduleSave();
}, {passive:false});
smartDeferredActions.mount();
smartMediaInputController.mount();
smartPreviewEvents.mount();
smartMediaPlayback.mount();
smartComposerScheduler.mount();
smartInteractionView.mount();
smartImageResolution.mount();
smartImageDimensions.mount();
window.addEventListener('keydown', e => {
    if(window.CanvasViewAdjust?.isOpen()) return;
    const key = String(e.key || '').toLowerCase();
    if((e.code === 'Space' || e.key === ' ') && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)){
        const active = selectedNode();

    }
    if(key === 'r' && !isEditableTarget(e.target)) isRKeyDown = true;
    if(imageEditModal.classList.contains('open') && imageEditMode === 'preview' && !isEditableTarget(e.target)){
        if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
            e.preventDefault();
            if(!seekPreviewVideoFrames(e.key === 'ArrowLeft' ? -1 : 1)){
                navigatePreviewImage(e.key === 'ArrowLeft' ? -1 : 1);
            }
            return;
        }
    }
    if(!e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)){
        if(key === 'z'){
            if(e.repeat) return;
            e.preventDefault();
            toggleZoomPreview();
            return;
        }
        if(key === 'a'){
            if(e.repeat) return;
            e.preventDefault();
            toggleAssetLibrary();
            return;
        }
    }
    if((e.ctrlKey || e.metaKey) && key === 'c' && !isEditableTarget(e.target)){
        const selectionText = window.getSelection?.().toString() || '';
        if(selectionText) return;
        e.preventDefault();
        copySelectedNodes();
        return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'v' && !isEditableTarget(e.target) && nodeClipboard?.nodes?.length){
        smartDeferredActions.queuePaste();
    }
    if(e.key === 'Escape' && imageEditModal.classList.contains('open')){
        closeImageEditor();
        return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'z' && !isEditableTarget(e.target)){
        e.preventDefault();
        if(e.shiftKey) performRedo();
        else performUndo();
        return;
    }
    if((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedIds.length) && !isEditableTarget(e.target)){
        e.preventDefault();
        const ids = selectedIds.length ? selectedIds.slice() : [selectedId];
        pushUndo();
        ids.forEach(id => { undoSuppressed = true; deleteNode(id); undoSuppressed = false; });
        render();
        scheduleSave();
    }
    if((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'g' && !isEditableTarget(e.target)){
        e.preventDefault();
        const ids = selectedIds.length ? selectedIds.slice() : (selectedId ? [selectedId] : []);
        const ok = ids.map(id => ungroupNode(id)).some(Boolean);
        if(ok) return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'g' && !e.shiftKey && !isEditableTarget(e.target)){
        e.preventDefault();
        groupSelectedNodes();
    }
});
window.addEventListener('keyup', e => {
    if(String(e.key || '').toLowerCase() === 'r') isRKeyDown = false;
});
window.addEventListener('blur', () => {
    isRKeyDown = false;
});
engineSelect.onchange = () => {
    settings.engine = engineSelect.value;
    applyRecentSmartSettingsForCurrentMode();
    syncApiKindToggleVisibility();
    renderDynamicParams();
    persistActiveSmartSettings();
    scheduleSave();
};
function syncApiKindToggleVisibility(){
    if(!apiKindToggle) return;
    if(smartApiAudioMode(activeSettingsSubject(),settings) || smartHasAudioAnalysisInput()){apiKindToggle.style.display='none';return;}
    apiKindToggle.style.display = isApiLikeEngine(settings.engine) ? 'inline-flex' : 'none';
    apiKindToggle.querySelectorAll('[data-kind]').forEach(btn => btn.classList.toggle('active', btn.dataset.kind === (settings.apiKind || 'image')));
}
if(apiKindToggle){
    apiKindToggle.querySelectorAll('[data-kind]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const kind = btn.dataset.kind;
            if(kind === settings.apiKind) return;
            settings.apiKind = kind;
            applyRecentSmartSettingsForCurrentMode();
            syncApiKindToggleVisibility();
            renderDynamicParams();
            persistActiveSmartSettings();
            scheduleSave();
        };
    });
}
let promptResizeState = null;
const promptResize = document.getElementById('promptResize');
if(promptResize){
    promptResize.addEventListener('mousedown', e => {
        if(e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        promptResizeState = {
            startY: e.clientY,
            startH: Number(settings.promptH) || promptInput.offsetHeight || 124
        };
    });
}
runBtn.onclick = runGeneration;
cascadeRunBtn.onclick = () => {
    const node = selectedNode();
    const loopId = resolveSmartCascadeLoop(node?.id)?.node?.id || '';
    if(loopId && smartCascadeIsLoopRunning(loopId)) {
        requestSmartCascadeStop(loopId);
        return;
    }
    runSmartCascade();
};

if(assetToggle) assetToggle.onclick = () => toggleAssetLibrary();
if(assetCloseBtn) assetCloseBtn.onclick = () => toggleAssetLibrary(false);
if(smartWorkflowToggle) smartWorkflowToggle.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    if(smartWorkflowTransferModal?.classList.contains('open')) closeSmartWorkflowTransferModal();
    else openSmartWorkflowTransferModal();
};
smartWorkflowImportDropZone?.addEventListener('click', () => smartWorkflowImportInput?.click());
smartWorkflowImportDropZone?.addEventListener('dragenter', event => {
    event.preventDefault();
    event.stopPropagation();
    smartWorkflowImportDropZone.classList.add('drag-over');
});
smartWorkflowImportDropZone?.addEventListener('dragover', event => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    smartWorkflowImportDropZone.classList.add('drag-over');
});
smartWorkflowImportDropZone?.addEventListener('dragleave', event => {
    event.preventDefault();
    event.stopPropagation();
    if(!smartWorkflowImportDropZone.contains(event.relatedTarget)) smartWorkflowImportDropZone.classList.remove('drag-over');
});
smartWorkflowImportDropZone?.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    smartWorkflowImportDropZone.classList.remove('drag-over');
    const file = [...(event.dataTransfer?.files || [])].find(item => /\.(json|zip)$/i.test(item.name || ''));
    if(file) importSmartWorkflowFile(file);
    else toast('请拖入 JSON 或 ZIP 工作流文件');
});
smartWorkflowTransferModal?.addEventListener('pointerdown', e => e.stopPropagation());
smartWorkflowTransferModal?.addEventListener('mousedown', e => e.stopPropagation());
smartWorkflowTransferModal?.addEventListener('click', e => e.stopPropagation());
smartWorkflowTransferModal?.addEventListener('wheel', event => {
    event.stopPropagation();
}, {passive:true, capture:true});
smartWorkflowTransferModal?.addEventListener('dragover', event => {
    event.preventDefault();
    event.stopPropagation();
    if(smartWorkflowImportDropZone){
        event.dataTransfer.dropEffect = 'copy';
        smartWorkflowImportDropZone.classList.add('drag-over');
    }
});
smartWorkflowTransferModal?.addEventListener('dragleave', event => {
    event.preventDefault();
    event.stopPropagation();
    if(!smartWorkflowTransferModal.contains(event.relatedTarget)) smartWorkflowImportDropZone?.classList.remove('drag-over');
});
smartWorkflowTransferModal?.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    smartWorkflowImportDropZone?.classList.remove('drag-over');
    const file = [...(event.dataTransfer?.files || [])].find(item => /\.(json|zip)$/i.test(item.name || ''));
    if(file) importSmartWorkflowFile(file);
    else toast('请拖入 JSON 或 ZIP 工作流文件');
});
assetPanel?.addEventListener('pointerdown', e => e.stopPropagation());
assetPanel?.addEventListener('mousedown', e => e.stopPropagation());
assetPanel?.addEventListener('click', e => e.stopPropagation());
assetPanel?.addEventListener('wheel', e => {
    e.stopPropagation();
    // 滚动时取消待显示的悬浮预览并隐藏，避免滚动中加载大图卡顿。
    clearTimeout(assetHoverTimer);
    hideAssetHoverPreview();
    const scroller = e.target.closest?.('.asset-grid') || assetGrid;
    if(!scroller || getComputedStyle(scroller).display === 'none') return;
    const canScroll = scroller.scrollHeight > scroller.clientHeight || scroller.scrollWidth > scroller.clientWidth;
    if(!canScroll) return;
    e.preventDefault();
    scroller.scrollTop += e.deltaY;
    scroller.scrollLeft += e.deltaX;
}, {passive:false, capture:true});
assetDialogBackdrop?.addEventListener('pointerdown', e => e.stopPropagation());
assetDialogBackdrop?.addEventListener('mousedown', e => e.stopPropagation());
assetDialogBackdrop?.addEventListener('click', e => e.stopPropagation());
promptPresetPanel?.addEventListener('pointerdown', e => e.stopPropagation());
promptPresetPanel?.addEventListener('mousedown', e => e.stopPropagation());
promptPresetPanel?.addEventListener('click', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('pointerdown', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('mousedown', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('wheel', e => e.stopPropagation(), {passive:false});
promptTemplatePanel?.addEventListener('click', e => {
    e.stopPropagation();
    const apply = e.target.closest('[data-template-apply]');
    if(apply){ applyPromptTemplateToNode(apply.dataset.templateApply || 'positive'); return; }
    if(e.target.closest('[data-template-save-current]')){ saveCurrentPromptAsTemplate(); return; }
    if(e.target.closest('[data-template-new]')){ createBlankPromptTemplate(); return; }
    if(e.target.closest('[data-template-edit]')) { promptTemplateEditing = true; renderPromptTemplatePanel(); return; }
    if(e.target.closest('[data-template-edit-cancel]')) { promptTemplateEditing = false; renderPromptTemplatePanel(); return; }
    if(e.target.closest('[data-template-edit-save]')){ savePromptTemplateEdit(); return; }
    if(e.target.closest('[data-template-delete]')){ deletePromptTemplate(); return; }
    const cat = e.target.closest('[data-template-cat]');
    if(cat){
        promptTemplateCategory = cat.dataset.templateCat || 'all';
        promptTemplateSelectedId = '';
        promptTemplateEditing = false;
        renderPromptTemplatePanel({preserveScroll:false});
        return;
    }
    const catEdit = e.target.closest('[data-template-cat-edit]');
    if(catEdit){
        const id = catEdit.dataset.templateCatEdit || '';
        renamePromptTemplateGroup(id);
        return;
    }
    const catDelete = e.target.closest('[data-template-cat-delete]');
    if(catDelete){
        deletePromptTemplateGroup(catDelete.dataset.templateCatDelete || '');
        return;
    }
    if(e.target.closest('[data-template-group-edit]')){
        promptTemplateGroupEditMode = !promptTemplateGroupEditMode;
        renderPromptTemplatePanel({preserveScroll:false});
        return;
    }
    if(e.target.closest('[data-template-cat-new]')) { createPromptTemplateGroup(); return; }
    const card = e.target.closest('[data-template-id]');
    if(card){
        promptTemplateSelectedId = card.dataset.templateId || '';
        promptTemplateEditing = false;
        renderPromptTemplatePanel();
        return;
    }
});
if(promptPresetClose) promptPresetClose.onclick = closePromptPresetPanel;
if(promptTemplateClose) promptTemplateClose.onclick = closePromptTemplatePanel;
if(promptTemplateSearch) promptTemplateSearch.oninput = () => renderPromptTemplatePanel({preserveScroll:false});
if(promptTemplateLibrarySelect) promptTemplateLibrarySelect.onchange = async () => {
    activePromptLibraryId = promptTemplateLibrarySelect.value || 'system';
    promptTemplateSelectedId = '';
    // 切换词库必须重置分类筛选，否则上一个库的分类（如系统的“视角”）会把新库内容过滤为空。
    promptTemplateCategory = 'all';
    promptTemplateEditing = false;
    // 拉取最新数据，确保素材库管理里新建/新增的词库与提示词在画布即时可见。
    const want = activePromptLibraryId;
    try { await loadPromptTemplates(); } catch(e){}
    if(promptLibraries.some(lib => lib.id === want)) activePromptLibraryId = want;
    renderPromptLibrarySelect();
    renderPromptTemplatePanel({preserveScroll:false});
};
if(composerTemplateBtn) composerTemplateBtn.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    if(promptTemplatePanel?.classList?.contains('open') && promptTemplatePanel.dataset.target === 'composer'){
        closePromptTemplatePanel();
        return;
    }
    openPromptTemplatePanel(activeComposerNode()?.id || selectedNode()?.id || '', promptTemplateSelectedId, {target:'composer'});
};
if(promptPresetSelect) promptPresetSelect.onchange = () => renderPromptPresetPanel(promptPresetSelect.value);
[promptPresetName, promptPresetText].forEach(input => {
    input?.addEventListener('input', () => {
        resetPromptPresetDeleteState();
        setPromptPresetStatus(tr('smart.promptPresetEditing'));
    });
});
if(promptPresetApply) promptPresetApply.onclick = applySelectedPromptPreset;
if(promptPresetSave) promptPresetSave.onclick = saveSelectedPromptPreset;
if(promptPresetNew) promptPresetNew.onclick = createPromptPresetFromPanel;
if(promptPresetDelete) promptPresetDelete.onclick = deleteSelectedPromptPreset;
document.querySelectorAll('[data-asset-tab]').forEach(btn => {
    btn.onclick = () => {
        assetTab = btn.dataset.assetTab;
        if(assetTab === 'workflow' && assetLibraryIsLocal()){
            activeAssetLibraryId = assetLibrary.active_library_id || assetLibraries()[0]?.id || '';
        }
        renderAssetLibrary();
    };
});
if(assetLibrarySelect) assetLibrarySelect.onchange = () => {
    activeAssetLibraryId = assetLibrarySelect.value || '';
    activeAssetCategoryId = '';
    activeWorkflowAssetCategoryId = '';
    mentionAssetCategoryId = '';
    if(activeAssetLibraryId === LOCAL_ASSET_LIBRARY_ID) assetTab = 'image';
    renderAssetLibrary();
};
if(assetCategorySelect) assetCategorySelect.onchange = () => {
    if(assetTab === 'workflow') activeWorkflowAssetCategoryId = assetCategorySelect.value;
    else activeAssetCategoryId = assetCategorySelect.value;
    renderAssetLibrary();
};
if(assetAddCategoryBtn) assetAddCategoryBtn.onclick = async () => {
    const workflowMode = currentAssetTabIsWorkflow();
    const fallbackName = workflowMode ? '工作流' : tr('smart.assetFolder');
    const name = await openAssetNameDialog({title:tr('smart.assetNewFolder'), value:fallbackName, placeholder:fallbackName});
    if(!name) return;
    if(assetLibraryIsLocal()){
        const data = await fetch('/api/local-assets/folders', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({parent:localAssetFolderPath(), name})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '新建文件夹失败');
            return r.json();
        });
        setLocalAssetLibraryFromResponse(data);
        activeAssetCategoryId = data.folder?.path || activeAssetCategoryId;
        renderAssetLibrary();
        return;
    }
    const data = await fetch('/api/asset-library/categories', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:activeAssetLibraryId, name, type:workflowMode ? 'workflow' : 'image'})}).then(r => r.json());
    setActiveAssetTabCategory(data.category?.id || '');
    setAssetLibraryFromResponse(data);
};
if(assetRenameCategoryBtn) assetRenameCategoryBtn.onclick = async () => {
    const cat = activeAssetTabCategory();
    if(!cat) return;
    const name = await openAssetNameDialog({title:tr('smart.assetRenameFolder'), value:cat.name || '', placeholder:currentAssetTabIsWorkflow() ? '工作流' : tr('smart.assetFolder')});
    if(!name) return;
    if(assetLibraryIsLocal()){
        const data = await fetch('/api/local-assets/folders', {
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({path:cat.id || '', name})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '重命名文件夹失败');
            return r.json();
        });
        setLocalAssetLibraryFromResponse(data);
        activeAssetCategoryId = data.folder?.path || activeAssetCategoryId;
        renderAssetLibrary();
        return;
    }
    const data = await fetch(`/api/asset-library/categories/${encodeURIComponent(cat.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
    setAssetLibraryFromResponse(data);
};
function hasCanvasImageDrag(event){
    return Array.from(event.dataTransfer?.types || []).includes('application/x-smart-canvas-image');
}
function setAssetDragOver(active){
    return SmartAssetImport.setAssetDragOver(smartAssetPanelHost(), active);
}
function handleAssetPanelDragOver(e){
    return SmartAssetImport.handleAssetPanelDragOver(smartAssetPanelHost(), e);
}
async function handleAssetPanelDrop(e){
    return SmartAssetImport.handleAssetPanelDrop(smartAssetPanelHost(), e);
}
assetDropZone?.addEventListener('dragover', e => {
    if(hasCanvasImageDrag(e) || hasSmartImageDropData(e.dataTransfer)){
        e.preventDefault();
        e.stopPropagation();
        assetDropZone?.classList.add('drag-over');
    }
});
assetDropZone?.addEventListener('dragleave', () => assetDropZone?.classList.remove('drag-over'));
assetDropZone?.addEventListener('drop', handleAssetPanelDrop);
assetPanel?.addEventListener('dragover', handleAssetPanelDragOver);
assetPanel?.addEventListener('dragleave', e => { if(!assetPanel?.contains(e.relatedTarget)) setAssetDragOver(false); });
assetPanel?.addEventListener('drop', handleAssetPanelDrop);
const smartCreateMenuController=SmartCreateMenu.create(smartCreateMenuHost);
smartCreateMenuController.mount();

composer.addEventListener('pointerdown', event => event.stopPropagation());
composer.addEventListener('mousedown', event => event.stopPropagation());
composer.addEventListener('click', event => {
    // 点「生成」按钮不要收起已展开的参数栏:否则每生成一次参数栏就被收起,需重新点开。
    // 参数控件(.smart-control)内部点击本就不关;运行按钮也排除,让参数栏熬过生成与重渲染。
    if(!event.target.closest('.smart-control') && !event.target.closest('#runBtn') && !event.target.closest('#cascadeRunBtn')) closeAllSmartPopovers();
    event.stopPropagation();
});
promptInput.addEventListener('input', maybeOpenMentionPicker);
promptInput.addEventListener('input', () => {
    delete promptInput.dataset.preserveDraftOnce;
    savePromptDraftForCurrent();
    renderInputThumbsRow(selectedNode());
    scheduleSave();
});
promptInput.addEventListener('keyup', maybeOpenMentionPicker);
promptInput.addEventListener('mouseup', saveMentionRange);
promptInput.addEventListener('focus', saveMentionRange);
promptInput.addEventListener('keydown', event => {
    if(event.key === 'Escape') closeMentionPicker();
});
promptInput.addEventListener('mouseover', event => {
    const token = event.target.closest?.('.mention-image-token');
    if(!token) return;
    // 音频没有可预览的图像，不能把音频 URL 塞进 <img>（会显示破损图标），直接不弹悬浮预览。
    if(token.dataset.kind === 'audio'){ mentionPreview.style.display = 'none'; return; }
    let media = mentionPreview.querySelector('img,video');
    const isVideo = token.dataset.kind === 'video' || isVideoMediaItem({url:token.dataset.url, kind:token.dataset.kind});
    if(isVideo && media?.tagName?.toLowerCase() !== 'video'){
        media?.replaceWith(document.createElement('video'));
        media = mentionPreview.querySelector('video');
    } else if(!isVideo && media?.tagName?.toLowerCase() !== 'img'){
        media?.replaceWith(document.createElement('img'));
        media = mentionPreview.querySelector('img');
    }
    if(isVideo){
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.preload = 'metadata';
        media.disablePictureInPicture = true;
        media.setAttribute('disablepictureinpicture', '');
        media.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
        media.src = token.dataset.url || '';
        media.play?.().catch(() => {});
    } else {
        media.src = token.dataset.url || '';
        media.alt = 'preview';
    }
    const rect = token.getBoundingClientRect();
    mentionPreview.style.left = `${Math.min(window.innerWidth - 236, rect.left)}px`;
    mentionPreview.style.top = `${Math.min(window.innerHeight - 236, rect.bottom + 8)}px`;
    mentionPreview.style.display = 'block';
});
promptInput.addEventListener('mouseout', event => {
    if(event.target.closest?.('.mention-image-token')){
        mentionPreview.style.display = 'none';
        const media = mentionPreview.querySelector('img,video');
        media?.pause?.();
        media?.removeAttribute('src');
        media?.load?.();
    }
});
mentionPicker.addEventListener('mousedown', event => event.stopPropagation());
document.addEventListener('click', event => {
    if(!event.target.closest('.smart-control')) closeAllSmartPopovers();
    if(!event.target.closest('.mention-picker') && !event.target.closest('#promptInput') && !event.target.closest('[data-input-add-reference]')) closeMentionPicker();
    if(!event.target.closest('.prompt-preset-panel') && !event.target.closest('.prompt-preset-edit') && !event.target.closest('.prompt-preset-save')) closePromptPresetPanel();
    if(!event.target.closest('.prompt-template-panel') && !event.target.closest('.prompt-preset-edit') && !event.target.closest('#composerTemplateBtn') && !event.target.closest('.canvas-assistant-template')) closePromptTemplatePanel();
});
document.addEventListener('keydown', event => {
    if(window.CanvasViewAdjust?.isOpen()) return;
    if(event.key === 'Escape') { closeSmartLogLightbox(); closeAllSmartPopovers(); closeCreateMenu(); closeSmartCanvasLog(); closeSmartCanvasShortcuts(); closePromptPresetPanel(); closePromptTemplatePanel(); }
});
function cropDragModeFromPointer(event){
    return SmartImageEditor.cropDragModeFromPointer(smartImageEditorHost(), event);
}
function smartImageEditorEventHost(){
    return {
        applyImageEditZoom:(...args)=>applyImageEditZoom(...args),
        applyPanoramaRatio:(...args)=>applyPanoramaRatio(...args),
        applyPreviewTransform:(...args)=>applyPreviewTransform(...args),
        beginCropDrag:(...args)=>beginCropDrag(...args),
        beginEditDraw:(...args)=>beginEditDraw(...args),
        beginEditText:(...args)=>beginEditText(...args),
        beginEditTextInline:(...args)=>beginEditTextInline(...args),
        beginGridJoinDrag:(...args)=>beginGridJoinDrag(...args),
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
        endGridJoinDrag:(...args)=>endGridJoinDrag(...args),
        get gridCustomDrag(){return gridCustomDrag;},
        get gridJoinDrag(){return gridJoinDrag;},
        get gridOperationMode(){return gridOperationMode;},
        hitEditTextItem:(...args)=>hitEditTextItem(...args),
        get imageEditModal(){return imageEditModal;},
        get imageEditMode(){return imageEditMode;},
        get imageEditPanDrag(){return imageEditPanDrag;},
        set imageEditPanDrag(value){imageEditPanDrag=value;},
        get imageEditZoom(){return imageEditZoom;},
        set imageEditZoom(value){imageEditZoom=value;},
        moveEditDraw:(...args)=>moveEditDraw(...args),
        moveEditText:(...args)=>moveEditText(...args),
        moveGridJoinDrag:(...args)=>moveGridJoinDrag(...args),
        get panoramaState(){return panoramaState;},
        get previewCompareDrag(){return previewCompareDrag;},
        set previewCompareDrag(value){previewCompareDrag=value;},
        get previewCompareIndex(){return previewCompareIndex;},
        get previewCompareOn(){return previewCompareOn;},
        get previewPan(){return previewPan;},
        set previewPan(value){previewPan=value;},
        get previewPanDrag(){return previewPanDrag;},
        set previewPanDrag(value){previewPanDrag=value;},
        get previewZoom(){return previewZoom;},
        set previewZoom(value){previewZoom=value;},
        refreshGridSplitPreview:(...args)=>refreshGridSplitPreview(...args),
        refreshPanoramaControls:(...args)=>refreshPanoramaControls(...args),
        renderCropBox:(...args)=>renderCropBox(...args),
        resizeCropFromDrag:(...args)=>resizeCropFromDrag(...args),
        resizeOutpaintFromDrag:(...args)=>resizeOutpaintFromDrag(...args),
        resizePanoramaViewer:(...args)=>resizePanoramaViewer(...args),
        seekPreviewVideoFrames:(...args)=>seekPreviewVideoFrames(...args),
        setCropAspectPreset:(...args)=>setCropAspectPreset(...args),
        setImageEditMode:(...args)=>setImageEditMode(...args),
        setImageResizeScale:(...args)=>setImageResizeScale(...args),
        setPreviewComparePos:(...args)=>setPreviewComparePos(...args),
        setSelectedEditTextItem:(...args)=>setSelectedEditTextItem(...args),
        syncGridGapValue:(...args)=>syncGridGapValue(...args),
        syncImageEditOverflow:(...args)=>syncImageEditOverflow(...args),
        syncSelectedEditTextStyleFromBrush:(...args)=>syncSelectedEditTextStyleFromBrush(...args),
        updateZoomLabel:(...args)=>updateZoomLabel(...args),
        get window(){return window;},
    };
}
const smartImageEditorEvents=SmartImageEditorEvents.create(smartImageEditorEventHost);
smartImageEditorEvents.mount();
window.addEventListener('studio-theme-change', event => applyTheme(event.detail?.theme || 'light'));
try {
    const apiChannel = new BroadcastChannel('studio-api');
    apiChannel.onmessage = async event => {
        if(event.data?.type === 'providers-changed' || event.data?.type === 'workflows-changed' || event.data?.type === 'comfy-instances-changed'){
            await refreshSmartConfigFromSettings();
        }
        if(event.data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(event.data);
        if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);
    };
} catch(e) {}
window.addEventListener('focus', () => {
    if(Date.now() - lastConfigRefreshAt > 1200) refreshSmartConfigFromSettings();
});
window.addEventListener('message', event => {
    if(event.origin && event.origin !== location.origin) return;
    if(event.data?.type === 'studio-theme') applyTheme(event.data.theme || 'light');
    if(event.data?.type === 'providers-changed' || event.data?.type === 'workflows-changed' || event.data?.type === 'comfy-instances-changed') refreshSmartConfigFromSettings();
    if(event.data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(event.data);
    if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);
    if(event.data?.type === 'studio-lang' && window.StudioI18n) {
        window.StudioI18n.set(event.data.lang || 'zh');
    }
});
window.addEventListener('studio-lang-change', () => {
    renderDynamicParams();
    renderInputThumbsRow(selectedNode());
    renderAssetLibrary();
    if(document.getElementById('imageEditModal')?.classList.contains('open')){
        setImageEditMode(imageEditMode);
    }
    if(promptTemplatePanel?.classList?.contains('open')) renderPromptTemplatePanel();
    render();
});
function smartAssistantCreationSettings(){
    const names=['engine','provider_id','model','ratio','resolution','quality','customRatio','customSize','customRatioWidth','customRatioHeight','customWidth','customHeight','videoProvider','videoModel','videoDuration','videoAspect','videoResolution','videoEnhancePrompt','videoEnableUpsample','videoWatermark','videoCameraFixed','videoGenerateAudio','videoMultimodal','videoUseFrameRoles'];
    return Object.fromEntries(names.filter(key=>settings[key]!==undefined).map(key=>[key,settings[key]]));
}
async function smartAssistantImageRequest(proposal){
    const node=nodes.find(n=>n.id===proposal.nodeId && n.type==='smart-image');
    if(!canvas || canvasId!==proposal.canvasId || !node) throw new Error('画布或生成节点已变化，请重新提出方案');
    if(smartNodeInFlight(node)) throw new Error('该节点还有原任务，请先在画布查询或恢复原任务');
    // 方案确认时以用户本轮明确选择的平台/模型为准，避免沿用画布中旧生成节点的配置。
    if(proposal.provider && proposal.model){ node.runSettings={...(node.runSettings||{}),provider_id:proposal.provider,model:proposal.model}; }
    const runSettings=smartSettingsForNode(node);
    return {prompt:proposal.prompt,provider_id:runSettings.provider_id,model:runSettings.model,size:sizeForRun(runSettings),
        aspect_ratio:API_RATIO_VALUES[runSettings.ratio]||(runSettings.ratio==='custom'?String(runSettings.customRatio||'').trim():''),resolution:['1k','2k','4k'].includes(runSettings.resolution)?runSettings.resolution:'',
        reference_images:proposal.referenceImages.map(url=>({url,kind:'image'})),quality:runSettings.quality||'auto',n:1};
}
async function smartAssistantGenerateImage(proposal,task){
    const node=nodes.find(n=>n.id===proposal.nodeId && n.type==='smart-image');
    if(!canvas || canvasId!==proposal.canvasId || !node || !task?.task_id) throw new Error('画布或任务已变化，请查询原任务');
    if(node.assistantCompletedTaskId===task.task_id) return;
    if(smartPendingTasks(node).some(p=>p.taskId===task.task_id)){await resumeSmartPendingNode(node);return;}
    if(smartNodeInFlight(node)) throw new Error('该节点正在生成，请查看画布中的任务');
    node.assistantTaskId=task.task_id;
    await runGeneration({assistantProposal:proposal,acceptedTask:task});
    await saveCanvas();
}
function invalidateSmartVideoDeconstruction(){
    window.CanvasVideoDeconstructionBridge?.begin();
    window.CanvasVideoDeconstructionUI?.closeAll(true);
}
function initSmartVideoDeconstructionBridge(){
    if(!window.CanvasVideoDeconstructionHost || window.CanvasVideoDeconstructionBridge) return;
    let generation=0;
    const sourceFor=(nodeId,index,url,title)=>{
        const node=nodes.find(item=>item.id===nodeId);
        const item=imageForDisplay(node?.images?.[index]);
        if(!node || !item?.url || item.url!==url || mediaKindForItem(item)!=='video') return null;
        return {canvasId:canvasId,nodeId,resultId:item.id||item.resultId||item.url,sourceUrl:item.url,title:title||item.name||'视频'};
    };
    const bridge=window.CanvasVideoDeconstructionHost.create({
        tableType:'smart-shot-table',
        getState:()=>({canvas:canvas ? {...canvas,id:canvasId} : {id:canvasId},nodes,connections:canvas?.connections||[],generation,scale:viewport.scale}),
        uid,
        pushUndo,
        save:()=>saveCanvas(),
        render,
        landFrames:(ctx,result)=>{
            const operation=result.operationId||result.id;
            let group=nodes.find(n=>n.frameGroupOperationId===operation);
            const prior=new Set((group?.images||[]).map(item=>item.frameIndex));
            const fresh=(result.frames||[]).filter(f=>f.url&&!prior.has(f.index));
            if(!fresh.length)return [];
            pushUndo();
            if(!group){const rect=nodeRect(ctx.sourceNode);group={id:uid('group'),type:'smart-group',title:`拆自${ctx.source.title||'视频'}`,x:rect.x+rect.width+96,y:rect.y,items:[],images:[],scale:1,frameGroupOperationId:operation,created_at:Date.now()};nodes.push(group);}
            const images=fresh.map(f=>({url:f.url,name:`${ctx.source.title||'视频'}·${window.CanvasVideoDeconstructionModel.formatTime(f.seconds||0)}`,kind:'image',frameIndex:f.index,frameOperationId:operation}));
            group.images.push(...images);
            group.w=Math.min(4,group.images.length)*292+16;
            group.h=Math.ceil(group.images.length/4)*222+60;
            selectedId=group.id;selectedIds=[];selectedImage={nodeId:'',index:-1};
            saveCanvas();render();return images;
        },
        readSource:source=>{const node=nodes.find(item=>item.id===source.nodeId);const index=(node?.images||[]).findIndex(item=>{const value=imageForDisplay(item);return value?.url===source.sourceUrl&&(value.id||value.resultId||value.url)===source.resultId;});return index>=0?sourceFor(source.nodeId,index,source.sourceUrl,source.title):null;},
        select:ids=>{selectedIds=ids.slice();selectedId=ids.length===1?ids[0]:'';selectedImage={nodeId:'',index:-1};syncSelectionUi?.();},
        defaultImageSettings:()=>{const s=smartSettingsForNode();return s.engine==='api'&&s.apiKind!=='video'?{...s,providerId:s.provider_id}:{};},
        defaultVideoSettings:()=>{const s=smartSettingsForNode();return s.engine==='api'?s:{};},
        nodeWidth:n=>nodeRect(n).width,
        rowSpacing:540,
        videoMedia:n=>(n.images||[]).map(imageForDisplay).filter(item=>item?.url&&mediaKindForItem(item)==='video').map(item=>({...item,kind:'video',sourceNodeId:n.id,sourceResultId:item.id||item.resultId||item.url})),
        addShotCollection:({table,media,existing})=>{
            if(existing&&existing.type!=='smart-group')throw new Error('原镜头分组已改变，请先核对');
            const collection=existing||{id:uid('group'),type:'smart-group',x:Math.max(...nodes.map(n=>n.x+nodeRect(n).width))+96,y:table.y,w:900,h:320,title:'所选镜头视频 · 按镜号整理',items:[],images:[],scale:1,created_at:Date.now()};
            collection.images=collection.images||[];for(const item of media){const key=JSON.stringify([item.rowId,item.url,item.sourceResultId]);if(!collection.images.some(i=>i.shotResultKey===key))collection.images.push({...item,shotResultKey:key});}
            if(!existing)nodes.push(collection);return collection;
        },
        collectionNotice:'已按镜号整理到视频分组，可预览及批量下载。智能画布当前没有剪辑时间线；剪辑与成片导出请使用普通画布的剪辑节点。',
        validateVideoSettings:s=>videoApiProviders().some(p=>p.id===s.videoProvider&&p.enabled!==false&&providerVideoModels(s.videoProvider).includes(s.videoModel)),
        setVideoPrompt:(node,text)=>setPromptDraftForNode(node,text),
        setImagePrompt:(node,text)=>setPromptDraftForNode(node,text),
        createVideoChain:({row,promptText,id,table,settings,x,y,uid:makeId,imageNodeId})=>{
            const video={id:makeId('smart'),type:'smart-image',x,y,w:316,h:260,promptDraftText:promptText,promptDraftHtml:escapeHtml(promptText),promptDraftTouched:true,title:`镜头 ${row.index} · 视频`,images:[],runSettings:{...cloneSmartSettings(initialSmartSettings),...settings,engine:'api',apiKind:'video',videoProvider:settings.videoProvider||'',videoModel:settings.videoModel||'',count:1},shotTableOrigin:{tableId:id,rowId:row.id,sourceFingerprint:table.shotTableData.source.fingerprint||table.shotTableData.source.sourceUrl,stage:'video',inlineOutput:true,imageNodeId,durationSeconds:row.durationSeconds,startSeconds:row.startSeconds,endSeconds:row.endSeconds},created_at:Date.now()};
            return {nodes:[video],connections:[{from:imageNodeId,to:video.id,kind:'input'}],promptId:video.id,generatorId:video.id,outputId:video.id};
        },
        focus:ids=>SmartViewport.fitAllNodesViewport(smartViewportHost(),ids),
        validateImageSettings:s=>{const provider=(imageProviders?.()||[]).find(p=>p.id===s.providerId);return !!provider && provider.enabled!==false && (providerImageModels?.(s.providerId)||[]).includes(s.model);},
        createGenerationChain:({row,promptText,table,id,settings,x,y,uid:makeId,creationOnly})=>{
            const image={id:makeId('smart'),type:'smart-image',x:creationOnly?x:x+380,y,w:316,h:260,title:`镜头 ${row.index} · 画面`,images:[],runSettings:{...cloneSmartSettings(initialSmartSettings),...settings,engine:'api',apiKind:'image',provider_id:settings.providerId||'',model:settings.model||'',ratio:settings.ratio||'square',resolution:settings.resolution||'1k',quality:settings.quality||'auto',count:1},shotTableOrigin:{tableId:id,rowId:row.id,sourceFingerprint:table.shotTableData.source.fingerprint||table.shotTableData.source.sourceUrl,durationSeconds:row.durationSeconds,motionPrompt:row.motionPrompt||row.cells.motion||''},created_at:Date.now()};
            if(creationOnly){setPromptDraftForNode(image,promptText??(row.imagePrompt||row.cells.visual||''));Object.assign(image.shotTableOrigin,{stage:'image',inlineOutput:true});return {nodes:[image],connections:[],promptId:image.id,generatorId:image.id,outputId:image.id};}
            const prompt={id:makeId('prompt'),type:'smart-prompt',x,y,w:316,h:210,title:'Prompt',text:promptText??(row.imagePrompt||row.cells.visual||''),promptSeparator:';',promptSplitEnabled:false,llmEnabled:false,created_at:Date.now()};
            return {nodes:[prompt,image],connections:[{from:prompt.id,to:image.id,kind:'input'}],promptId:prompt.id,generatorId:image.id,outputId:image.id};
        },
        runGenerators:async ids=>{
            const owner=canvasId,epoch=generation;
            for(const id of ids){if(canvasId!==owner||generation!==epoch)break;const node=nodes.find(item=>item.id===id);if(!node)continue;selectedId=id;selectedIds=[];selectedImage={nodeId:'',index:-1};await runGeneration({shotTableRun:true});}
        }
    });
    const begin=bridge.begin;bridge.begin=()=>{generation++;begin();};
    bridge.sourceFor=sourceFor;bridge.saveNow=async()=>{for(let attempt=0;attempt<8;attempt++){if(await saveCanvas())return true;await new Promise(resolve=>setTimeout(resolve,220));}return false;};bridge.onError=e=>toast(e.message||'视频拆解操作失败');bridge.onNotice=text=>toast(text);
    window.CanvasVideoDeconstructionBridge=bridge;
}
window.onload = async () => {
    applyTheme(localStorage.getItem('studio_theme') || localStorage.getItem('canvas_theme') || 'light');
    loadPromptPresets();
    loadPromptTemplateGroups();
    loadPromptTemplateOverrides();
    await loadPromptTemplates();
    if(window.StudioI18n) window.StudioI18n.apply();
    if(window.lucide) lucide.createIcons();
    connectAssetLibrarySyncSocket();
    await loadConfig();
    await loadAssetLibrary();
    await loadCanvas();
    initSmartVideoDeconstructionBridge();
    syncApiKindToggleVisibility();
    render();
    const nativeEditor=window.CanvasAssistantNative?.createEditor({
        getState:()=>({id:canvasId,kind:'smart',updatedAt:Number(canvas?.updated_at||0),nodes,connections:canvas?.connections||[],readOnly:!!canvas?.readOnly}),
        getSnapshot:()=>({nodes:canvasForStorage().nodes,connections:canvas?.connections||[]}),
        save:()=>saveCanvas(),pushUndo:()=>pushUndo(),render:()=>render(),setLoopPrompts:setSmartLoopPromptFieldValues,setGroupMembers:setSmartGroupMemberIds,
        exportWorkflow:typeof smartCanvasAssistantExportWorkflow==='function'?smartCanvasAssistantExportWorkflow:null,
        connectNodes:connectInputNode,
        runLLMNode:(node,options)=>runPromptLLMNode(node.id,options),
        runNode:(node,options)=>node?.type==='smart-loop' ? runSmartAssistantNativeLoop(node,options) : runGeneration({...options,assistantNativeNodeId:node.id}),
        validateLoopSlots:(node,proposal)=>validateSmartAssistantLoopSlots(node,proposal),
        applyTask:async(node,task,kind)=>{

            if(kind==='depth')return updateSmartDepthCapture(smartDepthPair(node),task,node.depthCapture.operationId);
            const id=task.task_id||task.id;
            if(task.status==='succeeded'){
                const outputs=resultMediaUrls(task.image_items?.length?task.image_items:task);
                if(!outputs.length)throw new Error('原任务成功但没有可回填的媒体结果');
                finalizeSmartPendingTask(node,id,outputs,kind);render();
            }else if(task.status==='failed'){
                const pending=smartPendingTasks(node).find(p=>p.taskId===id);
                if(pending){pending.querying=false;await resumeSmartPendingNode(node,{},id);}
            }
        },
        shotHost:()=>window.CanvasVideoDeconstructionBridge,shotModel:window.CanvasVideoDeconstructionModel,
        applyFields:(node,patch)=>{const fields={...patch};if(Object.hasOwn(fields,'promptDraftText')){setPromptDraftForNode(node,fields.promptDraftText);delete fields.promptDraftText;}Object.assign(node,fields);},
        createNode:type=>{const point={x:(viewport?.x||0)+120,y:(viewport?.y||0)+120};
            if(type==='smart-image')return createImageNodeAt(point);
            const factory={'smart-prompt':createPromptNode,'smart-loop':createLoopNode,'smart-group':createSmartGroupNode}[type];
            return factory?.(point.x,point.y);},
        check:proposal=>proposal.check(),
    });
    window.CanvasAssistant?.mount({
        kind:'smart',
        getContext:()=>canvas ? {id:canvasId,title:canvas.title,updatedAt:Number(canvas.updated_at||0),nodes,selectedNodeIds:selectedNodeIds(),creationSettings:smartAssistantCreationSettings()} : null,
        save:()=>saveCanvas(),
        refresh:()=>mergeReloadCanvasNow(),
        prepareImageRequest:smartAssistantImageRequest,
        generateImage:smartAssistantGenerateImage,
        nativeSnapshot:()=>nativeEditor?.snapshot(),
        executeNativeAction:proposal=>nativeEditor.execute(proposal),
        resumeNativeLoop:proposal=>nativeEditor.resumeLoop(proposal),
        syncNativeTask:proposal=>nativeEditor.syncTask(proposal),
        referencePreview:(item,size)=>item.kind==='video' ? smartVideoPreviewHtml(item,size,'preload="none"') : smartPreviewImgHtml(item.thumbnail||item.url,size,'loading="lazy" draggable="false"'),
        bindReferencePreviews:element=>bindSmartPreviewImageFallbacks(element),
        openPromptTemplates:async callback=>{canvasAssistantTemplateCallback=callback;await openPromptTemplatePanel('', '', {target:'assistant'});},
        addTextNode:async text=>{const node=createPromptNode((viewport?.x||0)+120,(viewport?.y||0)+120);if(!node)return false;node.text=String(text||'');render();scheduleSave();return true;},
        addImageNode:async (url,name,kind)=>{if(!url)return false;createNode((viewport?.x||0)+120,(viewport?.y||0)+120,[{url,name:name||'助手图片',kind:kind||'image'}],{select:true});return saveCanvas();},
        viewChanges:async ids=>{
            await mergeReloadCanvasNow();
            const affected=nodes.filter(node=>ids.includes(node.id));
            if(!affected.length)return false;
            selectedIds=affected.map(node=>node.id);selectedId=affected[0].id;render();fitAllNodesViewport();return true;
        },
    });
};

function applySelectedPromptPreset(){
    return SmartPromptPresets.applySelectedPromptPreset(smartPromptPresetHost());
}
function saveSelectedPromptPreset(){
    return SmartPromptPresets.saveSelectedPromptPreset(smartPromptPresetHost());
}
function createPromptPresetFromPanel(){
    return SmartPromptPresets.createPromptPresetFromPanel(smartPromptPresetHost());
}
function deleteSelectedPromptPreset(){
    return SmartPromptPresets.deleteSelectedPromptPreset(smartPromptPresetHost());
}
